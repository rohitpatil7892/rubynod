#!/usr/bin/env node
import { runAgent } from '@rubynod/ai';
import path from 'node:path';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  if (command === 'agent' || command === 'run') {
    const prompt = args[1] ?? 'List the main files in this project';
    const workspace = args.includes('--workspace')
      ? args[args.indexOf('--workspace') + 1]!
      : process.cwd();
    const mode = args.includes('--plan')
      ? 'plan'
      : args.includes('--ask')
        ? 'ask'
        : args.includes('--debug')
          ? 'debug'
          : 'agent';

    console.log(`Rubynod agent [${mode}] in ${workspace}\n`);

    for await (const event of runAgent({
      message: prompt,
      workspaceRoot: path.resolve(workspace),
      mode: mode as 'agent' | 'plan' | 'ask' | 'debug',
    })) {
      if (event.type === 'text') {
        const d = event.data as { text: string };
        process.stdout.write(d.text);
      }
      if (event.type === 'tool_start') {
        const d = event.data as { name: string };
        console.log(`\n[tool] ${d.name}...`);
      }
      if (event.type === 'tool_end') {
        const d = event.data as { name: string; result: string };
        console.log(`[tool] ${d.name} done (${d.result.slice(0, 200)}...)`);
      }
      if (event.type === 'error') {
        console.error('\nError:', (event.data as { message: string }).message);
      }
      if (event.type === 'done') {
        console.log('\n--- done ---');
      }
    }
    return;
  }

  if (command === 'index') {
    const workspace = args[1] ?? process.cwd();
    const res = await fetch('http://127.0.0.1:3847/index/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: path.resolve(workspace) }),
    });
    const json = await res.json();
    console.log(json);
    return;
  }

  console.log(`Rubynod CLI

Usage:
  rubynod agent "<prompt>" [--workspace path] [--plan|--ask|--debug]
  rubynod index [workspace]   (requires AI service on :3847)

Env: OPENAI_API_KEY, RUBYNOD_PROVIDER, RUBYNOD_MODEL
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
