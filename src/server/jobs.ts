import type { Job } from "../shared/types";

const jobs = new Map<string, Job>();
const MAX_LOG_LINES = 200;

export interface JobHandle {
  readonly job: Job;
  step(name: string, progress?: number | null): void;
  progress(value: number | null): void;
  log(line: string): void;
}

/** Starts background work and tracks it so the UI can poll its progress. */
export function startJob(label: string, work: (handle: JobHandle) => Promise<string>): Job {
  const job: Job = {
    id: crypto.randomUUID(),
    label,
    status: "running",
    step: "Na fila",
    progress: null,
    log: [],
    songId: null,
    error: null,
  };
  jobs.set(job.id, job);

  const handle: JobHandle = {
    job,
    step(name, progress = null) {
      job.step = name;
      job.progress = progress;
      handle.log(name);
    },
    progress(value) {
      job.progress = value;
    },
    log(line) {
      job.log.push(line);
      if (job.log.length > MAX_LOG_LINES) job.log.shift();
    },
  };

  work(handle)
    .then((songId) => {
      job.songId = songId;
      job.status = "done";
      job.step = "Concluído";
      job.progress = 1;
    })
    .catch((error: unknown) => {
      job.status = "error";
      job.error = error instanceof Error ? error.message : String(error);
      handle.log(`Erro: ${job.error}`);
    });

  return job;
}

export const getJob = (id: string) => jobs.get(id) ?? null;
