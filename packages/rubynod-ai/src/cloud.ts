import { randomUUID } from 'node:crypto';

export interface CloudAgentJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  prompt: string;
  workspaceRoot: string;
  createdAt: string;
  result?: string;
  error?: string;
}

const jobs = new Map<string, CloudAgentJob>();

export function createCloudJob(prompt: string, workspaceRoot: string): CloudAgentJob {
  const job: CloudAgentJob = {
    id: randomUUID(),
    status: 'queued',
    prompt,
    workspaceRoot,
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getCloudJob(id: string): CloudAgentJob | undefined {
  return jobs.get(id);
}

export function listCloudJobs(): CloudAgentJob[] {
  return [...jobs.values()];
}

export async function runCloudJob(
  id: string,
  runner: (prompt: string, workspaceRoot: string) => Promise<string>
): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'running';
  try {
    job.result = await runner(job.prompt, job.workspaceRoot);
    job.status = 'completed';
  } catch (e) {
    job.status = 'failed';
    job.error = e instanceof Error ? e.message : String(e);
  }
}
