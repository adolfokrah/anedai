import { NextResponse } from 'next/server';

import { workDir } from '@/lib/seed';
import { connectBox } from '@/lib/session';
import { getProject } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const tail = (text: string, n = 400) => text.split('\n').slice(-n).join('\n');

/** Tail the running dev-server log(s) from the sandbox, for live debugging. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const manifest = await getProject(slug);
  if (!manifest) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  try {
    const box = await connectBox(manifest);
    const work = await workDir(box, manifest);
    const dev = await box.readFile(`${work}/.aned-dev.log`).catch(() => '');
    let docs = '';
    if (manifest.docsStartCmd) {
      const docsDir = await workDir(box, { subdir: manifest.docsSubdir });
      docs = await box.readFile(`${docsDir}/.aned-docs.log`).catch(() => '');
    }
    return NextResponse.json({
      dev: tail(dev),
      docs: docs ? tail(docs) : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
