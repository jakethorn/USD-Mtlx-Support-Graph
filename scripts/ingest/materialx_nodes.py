"""MaterialX node catalogue and reference shader-generator coverage, per release.

For every MaterialX release from 1.38.0 on, reads the standard data libraries
(libraries/**/*.mtlx) straight from the tag. No version upgrade is applied, so each release
is seen exactly as it shipped. It records:

  * every nodedef: node, library, group, inputs and outputs, and the release it appeared
    in or was removed from
  * for each shader-generator target (GLSL, MSL, OSL, MDL, Slang, …), whether the nodedef
    has a native implementation, works through a node graph whose nodes are all supported,
    or is unsupported

Target resolution mirrors MaterialX's NodeDef::getImplementation: first a target-specific
implementation, walking target inheritance (e.g. genmsl → genglsl), then a generic
(untargeted) node graph.

This is coverage of MaterialX's *own* code generators. Renderers that translate MaterialX
themselves can differ; that per-renderer data lives in data/products/.

Output: data/generated/materialx-nodes.json
"""
from __future__ import annotations

import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import checkout, log, sparse_repo, tags, version_key, write_json  # noqa: E402

REPO_URL = "https://github.com/AcademySoftwareFoundation/MaterialX"
SPARSE = ["/libraries/**/*.mtlx"]
MIN_VERSION = (1, 38, 0)
NON_NODE_TAGS = {"input", "output", "token", "parameter", "backdrop", "comment"}
# Implementations for this target are generated at build time (compiled .oso files), so
# they are not in the data libraries and coverage can't be read from them.
EXCLUDED_TARGETS = {"genoslnetwork"}

BARE_AMPERSAND = re.compile(r"&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)")
ATTRIBUTE_VALUE = re.compile(r'="([^"]*)"')


def lenient_xml(text: str) -> str:
    """MaterialX's parser (pugixml) accepts raw '&' and '<' inside attribute values, e.g.
    sourcecode="{{in1}} && {{in2}}" or "({{fg}} < 0.5) ? …". Escape them for ElementTree."""
    return ATTRIBUTE_VALUE.sub(
        lambda m: '="' + BARE_AMPERSAND.sub("&amp;", m.group(1)).replace("<", "&lt;") + '"', text
    )

TARGET_LABELS = {
    "genglsl": "GLSL",
    "essl": "ESSL (WebGL)",
    "genmsl": "Metal (MSL)",
    "genosl": "OSL",
    "genoslnetwork": "OSL network",
    "genmdl": "MDL",
    "genslang": "Slang",
}


@dataclass
class NodeDef:
    name: str
    node: str
    library: str
    group: str | None
    doc: str | None
    version: str | None
    is_default_version: bool
    inherit: str | None
    inputs: list[dict]
    outputs: list[dict]


@dataclass
class Graph:
    name: str
    target: str
    nodes: list[tuple[str, str | None, str | None]]  # (category, type, explicit nodedef)


@dataclass
class Library:
    nodedefs: dict[str, NodeDef] = field(default_factory=dict)
    # nodedef name → list of (target, kind, graph name) in document order
    impls: dict[str, list[tuple[str, str, str | None]]] = field(default_factory=dict)
    graphs: dict[str, Graph] = field(default_factory=dict)
    targets: dict[str, str | None] = field(default_factory=dict)  # target → inherit


def parse_ports(el: ET.Element, tag: str) -> list[dict]:
    ports = []
    for child in el.findall(tag):
        port = {"name": child.get("name"), "type": child.get("type")}
        if child.get("value") is not None:
            port["default"] = child.get("value")
        if child.get("enum"):
            port["enum"] = child.get("enum")
        if child.get("uniform") == "true":
            port["uniform"] = True
        ports.append(port)
    return ports


def load_library(libraries_dir: Path) -> Library:
    lib = Library()
    for path in sorted(libraries_dir.rglob("*.mtlx")):
        rel = path.relative_to(libraries_dir).parent.as_posix()
        # genglsl/genosl/… sub-folders hold implementations; the library is their parent.
        library = "/".join(p for p in rel.split("/") if not p.startswith("gen")) or rel
        try:
            root = ET.fromstring(lenient_xml(path.read_text(encoding="utf-8")))
        except ET.ParseError as e:
            log(f"  ! skipping unparsable {path.name}: {e}")
            continue
        for el in root:
            tag = el.tag
            if tag == "nodedef":
                nd = NodeDef(
                    name=el.get("name"),
                    node=el.get("node"),
                    library=library,
                    group=el.get("nodegroup"),
                    doc=el.get("doc"),
                    version=el.get("version"),
                    is_default_version=el.get("isdefaultversion") == "true",
                    inherit=el.get("inherit"),
                    inputs=parse_ports(el, "input") + parse_ports(el, "parameter"),
                    outputs=parse_ports(el, "output"),
                )
                if not nd.outputs and el.get("type"):  # pre-1.38 style single output
                    nd.outputs = [{"name": "out", "type": el.get("type")}]
                lib.nodedefs[nd.name] = nd
            elif tag == "implementation" and el.get("nodedef"):
                kind = "graph" if el.get("nodegraph") else "native"
                lib.impls.setdefault(el.get("nodedef"), []).append((el.get("target", ""), kind, el.get("nodegraph")))
            elif tag == "nodegraph":
                nodes = [
                    (child.tag, child.get("type"), child.get("nodedef"))
                    for child in el
                    if isinstance(child.tag, str) and child.tag not in NON_NODE_TAGS
                ]
                graph = Graph(name=el.get("name"), target=el.get("target", ""), nodes=nodes)
                lib.graphs[graph.name] = graph
                if el.get("nodedef"):
                    lib.impls.setdefault(el.get("nodedef"), []).append((graph.target, "graph", graph.name))
            elif tag == "targetdef" and el.get("name") not in EXCLUDED_TARGETS:
                lib.targets[el.get("name")] = el.get("inherit")

    # Resolve nodedef inheritance for inputs (inherited inputs first, own inputs override).
    def resolved_inputs(nd: NodeDef, seen: set[str]) -> list[dict]:
        if not nd.inherit or nd.inherit in seen or nd.inherit not in lib.nodedefs:
            return nd.inputs
        base = resolved_inputs(lib.nodedefs[nd.inherit], seen | {nd.name})
        own = {p["name"] for p in nd.inputs}
        return [p for p in base if p["name"] not in own] + nd.inputs

    for nd in lib.nodedefs.values():
        nd.inputs = resolved_inputs(nd, set())
    return lib


def target_chain(lib: Library, target: str) -> list[str]:
    chain, t = [], target
    while t and t not in chain:
        chain.append(t)
        t = lib.targets.get(t)
    return chain


def targets_match(attr: str, target: str) -> bool:
    return target in [t.strip() for t in attr.split(",") if t.strip()]


class Resolver:
    """Works out, per nodedef and target, whether MaterialX's generator can handle it."""

    def __init__(self, lib: Library):
        self.lib = lib
        self.by_node: dict[str, list[NodeDef]] = {}
        for nd in lib.nodedefs.values():
            self.by_node.setdefault(nd.node, []).append(nd)
        self.memo: dict[tuple[str, str], str] = {}

    def support(self, nodedef: str, target: str, stack: frozenset = frozenset()) -> str:
        key = (nodedef, target)
        if key in self.memo:
            return self.memo[key]
        if key in stack:
            return "none"
        stack = stack | {key}
        result = "none"
        impls = self.lib.impls.get(nodedef, [])
        chosen = None
        for candidate in target_chain(self.lib, target):
            chosen = next((i for i in impls if i[0] and targets_match(i[0], candidate)), None)
            if chosen:
                break
        if not chosen:
            chosen = next((i for i in impls if not i[0]), None)
        if chosen:
            _, kind, graph_name = chosen
            if kind == "native":
                result = "native"
            else:
                graph = self.lib.graphs.get(graph_name or "")
                ok = graph is not None and all(self.inner_supported(n, target, stack) for n in graph.nodes)
                result = "graph" if ok else "none"
        self.memo[key] = result
        return result

    def inner_supported(self, node: tuple[str, str | None, str | None], target: str, stack: frozenset) -> bool:
        category, typ, explicit = node
        if explicit and explicit in self.lib.nodedefs:
            return self.support(explicit, target, stack) != "none"
        candidates = self.by_node.get(category, [])
        if not candidates:
            return False
        if typ and typ != "multioutput":
            typed = [nd for nd in candidates if len(nd.outputs) == 1 and nd.outputs[0]["type"] == typ]
            candidates = typed or candidates
        return any(self.support(nd.name, target, stack) != "none" for nd in candidates)


def main() -> None:
    repo = sparse_repo(REPO_URL + ".git", "MaterialX", SPARSE)
    versions = sorted(
        (t[1:] for t in tags(repo) if t.startswith("v") and t[1:].replace(".", "").isdigit()),
        key=version_key,
    )
    versions = [v for v in versions if version_key(v) >= MIN_VERSION]
    log(f"MaterialX releases: {', '.join(versions)}")

    per_version: dict[str, tuple[Library, Resolver]] = {}
    for v in versions:
        checkout(repo, f"v{v}")
        lib = load_library(repo / "libraries")
        per_version[v] = (lib, Resolver(lib))
        log(f"  {v}: {len(lib.nodedefs)} nodedefs, targets {sorted(lib.targets)}")

    latest = versions[-1]
    all_targets = sorted({t for lib, _ in per_version.values() for t in lib.targets}, key=lambda t: list(TARGET_LABELS).index(t) if t in TARGET_LABELS else 99)

    # nodedef name → first/last version it was present in
    first_seen: dict[str, str] = {}
    last_seen: dict[str, str] = {}
    for v in versions:
        for name in per_version[v][0].nodedefs:
            first_seen.setdefault(name, v)
            last_seen[name] = v

    def next_version(v: str) -> str | None:
        i = versions.index(v)
        return versions[i + 1] if i + 1 < len(versions) else None

    nodes: dict[str, dict] = {}
    for name in sorted(first_seen, key=lambda n: (first_seen[n] != versions[0], n)):
        v = last_seen[name]
        lib, resolver = per_version[v]
        nd = lib.nodedefs[name]
        support = {t: resolver.support(name, t) for t in all_targets if t in lib.targets}
        entry = {
            "name": name,
            "outputs": nd.outputs,
            "inputs": nd.inputs,
            "since": None if first_seen[name] == versions[0] else first_seen[name],
            "removedIn": None if v == latest else next_version(v),
            "support": support,
        }
        if nd.version:
            entry["version"] = nd.version
            entry["isDefaultVersion"] = nd.is_default_version
        node = nodes.setdefault(
            nd.node,
            {"name": nd.node, "library": nd.library, "group": nd.group, "doc": nd.doc, "nodedefs": []},
        )
        # Prefer metadata from the newest release that has this node.
        if v == latest or not node["doc"]:
            node.update({"library": nd.library, "group": nd.group, "doc": nd.doc or node["doc"]})
        node["nodedefs"].append(entry)

    for node in nodes.values():
        defs = node["nodedefs"]
        sinces = [d["since"] for d in defs]
        node["since"] = None if None in sinces else min(sinces, key=version_key)
        live = [d for d in defs if d["removedIn"] is None]
        node["removedIn"] = None if live else max((d["removedIn"] for d in defs), key=version_key)
        counted = live or defs
        node["coverage"] = {
            t: {
                "native": sum(d["support"].get(t) == "native" for d in counted),
                "graph": sum(d["support"].get(t) == "graph" for d in counted),
                "total": len(counted),
            }
            for t in all_targets
        }

    history = []
    for v in versions:
        lib, resolver = per_version[v]
        history.append(
            {
                "version": v,
                "nodedefs": len(lib.nodedefs),
                "nodes": len({nd.node for nd in lib.nodedefs.values()}),
                "supported": {
                    t: sum(resolver.support(n, t) != "none" for n in lib.nodedefs) for t in all_targets if t in lib.targets
                },
            }
        )

    write_json(
        "materialx-nodes.json",
        {
            "source": REPO_URL,
            "note": "Coverage of MaterialX's reference shader generators, read from the data libraries of each release.",
            "versions": versions,
            "latest": latest,
            "targets": [
                {"id": t, "label": TARGET_LABELS.get(t, t), "inherits": per_version[latest][0].targets.get(t)}
                for t in all_targets
            ],
            "history": history,
            "nodes": sorted(nodes.values(), key=lambda n: (n["library"], n["group"] or "", n["name"])),
        },
    )


if __name__ == "__main__":
    main()
