import type { APIRoute, GetStaticPaths } from 'astro';
import { generatedFiles } from '../../data/generated';

/** Machine-generated datasets, served as /data/<name>.json for reuse and for client-side views. */
export const getStaticPaths = (() =>
  Object.keys(generatedFiles).map((file) => ({ params: { file } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) => {
  const data = generatedFiles[params.file as keyof typeof generatedFiles];
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
