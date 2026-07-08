import * as k8s from '@kubernetes/client-node';

export interface CrawlerStatus {
  isRunning: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  activeJobs: string[];
}

export interface CrawlerRunResult {
  jobName: string;
}

const CRAWLER_NAMESPACE = process.env.CRAWLER_NAMESPACE?.trim() || 'schnapper-crawler';
const CRAWLER_CRONJOB_NAME = process.env.CRAWLER_CRONJOB_NAME?.trim() || 'schnapper-crawler';
const CRAWLER_LABEL_SELECTOR = 'app.kubernetes.io/name=schnapper-crawler';

function createKubeConfig(): k8s.KubeConfig {
  const kubeConfig = new k8s.KubeConfig();

  if (process.env.KUBERNETES_SERVICE_HOST) {
    kubeConfig.loadFromCluster();
    return kubeConfig;
  }

  try {
    kubeConfig.loadFromDefault();
    return kubeConfig;
  } catch (error) {
    throw new Error(
      `Unable to load Kubernetes config: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function nextSixHourBoundary(from: Date): Date {
  const next = new Date(from);
  next.setMinutes(0, 0, 0);
  next.setHours(Math.floor(next.getHours() / 6) * 6);

  if (next <= from) {
    next.setHours(next.getHours() + 6);
  }

  return next;
}

function getLatestTimestamp(candidate: Date | undefined, current: Date | null): Date | null {
  if (!candidate) {
    return current;
  }

  if (!current || candidate.getTime() > current.getTime()) {
    return candidate;
  }

  return current;
}

export async function getCrawlerStatus(): Promise<CrawlerStatus> {
  const kubeConfig = createKubeConfig();
  const batchApi = kubeConfig.makeApiClient(k8s.BatchV1Api);

  const [cronJobResponse, jobsResponse] = await Promise.all([
    batchApi.readNamespacedCronJob({ name: CRAWLER_CRONJOB_NAME, namespace: CRAWLER_NAMESPACE }),
    batchApi.listNamespacedJob({ namespace: CRAWLER_NAMESPACE, labelSelector: CRAWLER_LABEL_SELECTOR }),
  ]);

  const cronJob = cronJobResponse;
  const jobs = jobsResponse.items;

  const runningJobs = jobs.filter((job) => {
    const status = job.status;
    return Boolean(status && !status.completionTime && !status.failed && !status.succeeded);
  });

  let lastRunAt: Date | null = cronJob.status?.lastScheduleTime ?? null;
  for (const job of jobs) {
    const startedAt = job.status?.startTime;
    lastRunAt = getLatestTimestamp(startedAt ? new Date(startedAt) : undefined, lastRunAt);
  }

  const referenceTime = lastRunAt ?? new Date();
  return {
    isRunning: runningJobs.length > 0,
    lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
    nextRunAt: nextSixHourBoundary(referenceTime).toISOString(),
    activeJobs: runningJobs.map((job) => job.metadata?.name).filter((name): name is string => Boolean(name)),
  };
}

export async function triggerCrawlerRun(): Promise<CrawlerRunResult> {
  const kubeConfig = createKubeConfig();
  const batchApi = kubeConfig.makeApiClient(k8s.BatchV1Api);

  const status = await getCrawlerStatus();
  if (status.isRunning) {
    throw new Error('Crawler is already running');
  }

  const cronJob = await batchApi.readNamespacedCronJob({ name: CRAWLER_CRONJOB_NAME, namespace: CRAWLER_NAMESPACE });
  const jobTemplate = cronJob.spec?.jobTemplate?.spec;
  if (!jobTemplate?.template) {
    throw new Error('CronJob template is missing');
  }

  const jobName = `schnapper-crawler-manual-${Date.now()}`;
  const job: k8s.V1Job = {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: jobName,
      namespace: CRAWLER_NAMESPACE,
      labels: {
        'app.kubernetes.io/name': 'schnapper-crawler',
        'app.kubernetes.io/part-of': 'schnapper',
      },
      annotations: {
        'cronjob.kubernetes.io/instantiate': 'manual',
      },
    },
    spec: {
      backoffLimit: jobTemplate.backoffLimit ?? 1,
      ttlSecondsAfterFinished: 3600,
      template: {
        ...jobTemplate.template,
        metadata: {
          ...jobTemplate.template.metadata,
          labels: {
            ...(jobTemplate.template.metadata?.labels ?? {}),
            'app.kubernetes.io/name': 'schnapper-crawler',
          },
        },
      },
    },
  };

  await batchApi.createNamespacedJob({ namespace: CRAWLER_NAMESPACE, body: job });

  return { jobName };
}
