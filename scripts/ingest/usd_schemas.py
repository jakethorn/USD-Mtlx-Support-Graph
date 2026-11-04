"""OpenUSD schema catalogue per release, read from each domain's generatedSchema.usda.

For every scheduled OpenUSD release (0.7.0 → latest) it records every schema class:
concrete prim types (Mesh, SphereLight, …), abstract base types and API schemas, with
their properties and the release each one first appeared in or was removed from. This
drives the "how has USD grown, and what do you miss on an older version" views.

Parsing is deliberately simple. generatedSchema.usda is machine-written by usdGenSchema
with a stable layout:
  class <TypeName> "<Name>" (metadata) { properties }   concrete typed schema
  class "<Name>" (metadata) { properties }              abstract typed or API schema
Properties sit at 4-space indent inside the braces. Triple-quoted doc strings are skipped.

Output: data/generated/usd-schemas.json
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import checkout, log, sparse_repo, tags, version_key, write_json  # noqa: E402

REPO_URL = "https://github.com/PixarAnimationStudios/OpenUSD"
SPARSE = ["/pxr/**/generatedSchema.usda", "/pxr/**/schema.usda", "!/pxr/**/testenv/**"]
VERSIONED_NAME = re.compile(r"^(\w+?)_(\d+)$")  # schema versioning: Capsule_1 is version 1 of Capsule
# Scheduled releases only: 0.7.0, 0.8.0, 18.09, …, 26.11.0 (no hotfixes like 22.05a / 26.11.1).
RELEASE_TAG = re.compile(r"^v(0\.\d+\.0|\d{2}\.\d{2}(?:\.0)?)$")

DOMAIN_LABELS = {
    "usd": "Core",
    "usdGeom": "Geometry",
    "usdShade": "Shading",
    "usdLux": "Lighting",
    "usdSkel": "Skeletal animation",
    "usdVol": "Volumes",
    "usdPhysics": "Physics",
    "usdRender": "Render settings",
    "usdMedia": "Media",
    "usdUI": "UI hints",
    "usdRi": "RenderMan",
    "usdHydra": "Hydra",
    "usdMtlx": "MaterialX",
    "usdProc": "Procedurals",
    "usdSemantics": "Semantics",
}

CLASS_LINE = re.compile(r'^class\s+(?:(\w+)\s+)?"(\w+)"')
# Class bodies open with "{" on its own line (generated files) or ") {" (hand-written schema.usda).
BODY_OPEN = re.compile(r"^(?:\)\s*)?\{\s*$|^class\b.*\{\s*$")
INHERITS = re.compile(r"inherits\s*=\s*</(\w+)>")
API_TYPE = re.compile(r'apiSchemaType\s*=\s*"(\w+)"')
DOC_BRIEF = re.compile(r'userDocBrief\s*=\s*"""(.*?)"""', re.S)
DOC = re.compile(r'\bdoc\s*=\s*"""(.*?)"""', re.S)
PROPERTY = re.compile(
    r"^    (?:custom\s+)?(?:uniform\s+|varying\s+|config\s+)?(rel|[A-Za-z0-9]+(?:\[\])?)\s+([A-Za-z_][\w:]*)\s*(?:=|\(|$)"
)


def domain_label(domain: str) -> str:
    if domain in DOMAIN_LABELS:
        return DOMAIN_LABELS[domain]
    words = re.sub(r"([a-z])([A-Z])", r"\1 \2", re.sub(r"^usd", "", domain)).strip()
    return words[:1].upper() + words[1:] if words else domain


# Doxygen markup as it appears in usda strings, where backslashes are doubled: \\em, \\ref, …
DOXYGEN = re.compile(r"\\{1,2}(?:ref|em|a|c|b|p|li|note|sa|see|code|endcode)\b\s*|\\{2}")


def brief(text: str | None) -> str | None:
    if not text:
        return None
    text = " ".join(DOXYGEN.sub("", text).split())
    first = re.split(r"(?<=[.!?])(?<!i\.e\.)(?<!e\.g\.)\s", text, maxsplit=1)[0]
    return first if len(first) <= 240 else first[:237].rstrip() + "…"


def parse_schema_file(path: Path, domain: str) -> list[dict]:
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    schemas: list[dict] = []
    current: dict | None = None
    header: list[str] = []
    in_body = False
    in_string = False

    for line in lines:
        # Doc strings can contain code samples with '{' / '}' / 'class' at column 0, so
        # structure is only recognised outside triple-quoted strings.
        was_in_string = in_string
        if line.count('"""') % 2 == 1:
            in_string = not in_string
        if was_in_string:
            if current is not None and not in_body:
                header.append(line)
            continue

        if current is None:
            m = CLASS_LINE.match(line)
            if m:
                type_name, name = m.groups()
                current = {"name": name, "typeName": type_name, "domain": domain, "properties": []}
                header, in_body = [line], bool(BODY_OPEN.search(line))
            continue

        # Inside a class: header metadata until the body opens ("{" or ") {"), then
        # properties until the closing '}'.
        if not in_body:
            header.append(line)
            if BODY_OPEN.match(line):
                in_body = True
            continue

        if line.startswith("}"):
            text = "\n".join(header)
            inherits = INHERITS.search(text)
            api = API_TYPE.search(text)
            doc = DOC_BRIEF.search(text) or DOC.search(text)
            name = current["name"]
            if current["typeName"]:
                kind = "concrete"
            elif name.endswith("API"):
                kind = "api"
            else:
                kind = "abstract"
            current.update(
                {
                    "kind": kind,
                    "apiType": (api.group(1) if api else ("singleApply" if kind == "api" else None)),
                    "inherits": inherits.group(1) if inherits else None,
                    "doc": brief(doc.group(1) if doc else None),
                }
            )
            schemas.append(current)
            current = None
            continue

        m = PROPERTY.match(line)
        if m and m.group(2) not in {"doc", "customData", "displayName", "displayGroup", "allowedTokens"}:
            current["properties"].append({"name": m.group(2), "type": m.group(1)})
    return schemas


def load_release(repo: Path) -> dict[str, dict]:
    """generatedSchema.usda gives the flattened property list. The hand-written schema.usda
    next to it gives the parent type, the class's own description and its own properties.
    (Newer generated files drop `inherits` and can carry a base class's doc brief.)"""
    schemas: dict[str, dict] = {}
    for path in sorted((repo / "pxr").rglob("generatedSchema.usda")):
        if "testenv" in path.parts:
            continue
        domain = path.parent.name
        authored = {}
        if (path.parent / "schema.usda").exists():
            authored = {s["name"]: s for s in parse_schema_file(path.parent / "schema.usda", domain)}
        for s in parse_schema_file(path, domain):
            own = authored.get(s["name"])
            if own:
                s["inherits"] = own["inherits"] or s["inherits"]
                s["doc"] = own["doc"] or s["doc"]
                own_props = {p["name"] for p in own["properties"]}
                for p in s["properties"]:
                    # Multiple-apply schemas namespace their generated properties
                    # (collection:__INSTANCE_NAME__:includes), the authored ones don't.
                    bare = p["name"].rsplit("__INSTANCE_NAME__:", 1)[-1]
                    if p["name"] not in own_props and bare not in own_props:
                        p["inherited"] = True
            # The core "Typed"/"APISchemaBase" bases are defined once in usd; keep the first definition.
            schemas.setdefault(s["name"], s)
    return schemas


def main() -> None:
    repo = sparse_repo(REPO_URL + ".git", "OpenUSD", SPARSE)
    versions = sorted((m.group(1) for t in tags(repo) if (m := RELEASE_TAG.match(t))), key=version_key)
    log(f"OpenUSD releases: {', '.join(versions)}")

    per_version: dict[str, dict[str, dict]] = {}
    for v in versions:
        checkout(repo, f"v{v}")
        per_version[v] = load_release(repo)
        concrete = sum(s["kind"] == "concrete" for s in per_version[v].values())
        log(f"  {v}: {len(per_version[v])} schemas ({concrete} concrete)")

    latest = versions[-1]
    first: dict[str, str] = {}
    last: dict[str, str] = {}
    prop_first: dict[tuple[str, str], str] = {}
    for v in versions:
        for name, s in per_version[v].items():
            first.setdefault(name, v)
            last[name] = v
            for p in s["properties"]:
                prop_first.setdefault((name, p["name"]), v)

    def after(v: str) -> str | None:
        i = versions.index(v)
        return versions[i + 1] if i + 1 < len(versions) else None

    schemas = []
    for name in first:
        s = per_version[last[name]][name]
        versioned = VERSIONED_NAME.match(name)
        version_of = versioned.group(1) if versioned and versioned.group(1) in first else None
        schemas.append(
            {
                "name": name,
                "domain": s["domain"],
                "kind": s["kind"],
                **({"typeName": s["typeName"]} if s["typeName"] else {}),
                **({"apiType": s["apiType"]} if s["apiType"] else {}),
                **({"versionOf": version_of, "schemaVersion": int(versioned.group(2))} if version_of else {}),
                "inherits": s["inherits"],
                "doc": s["doc"],
                "since": None if first[name] == versions[0] else first[name],
                "removedIn": None if last[name] == latest else after(last[name]),
                "properties": [
                    {
                        "name": p["name"],
                        "type": p["type"],
                        **({"inherited": True} if p.get("inherited") else {}),
                        "since": None if prop_first[(name, p["name"])] == versions[0] else prop_first[(name, p["name"])],
                    }
                    for p in s["properties"]
                ],
            }
        )

    domains = sorted({s["domain"] for s in schemas}, key=lambda d: (d not in DOMAIN_LABELS, list(DOMAIN_LABELS).index(d) if d in DOMAIN_LABELS else 0, d))
    history = []
    for v in versions:
        rel = per_version[v].values()
        history.append(
            {
                "version": v,
                "schemas": len(per_version[v]),
                "concrete": sum(s["kind"] == "concrete" for s in rel),
                "api": sum(s["kind"] == "api" for s in rel),
                "properties": sum(len(s["properties"]) for s in rel),
                "byDomain": {d: sum(s["domain"] == d for s in rel) for d in domains if any(s["domain"] == d for s in rel)},
            }
        )

    write_json(
        "usd-schemas.json",
        {
            "source": REPO_URL,
            "note": "Schema classes and properties read from each release's generatedSchema.usda files.",
            "versions": versions,
            "latest": latest,
            "domains": [{"id": d, "label": domain_label(d)} for d in domains],
            "history": history,
            "schemas": sorted(schemas, key=lambda s: (domains.index(s["domain"]), s["kind"] != "concrete", s["name"])),
        },
    )


if __name__ == "__main__":
    main()
