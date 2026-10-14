// Preloaded into the server process: exits when the mirin host that spawned it
// is gone (SIGKILL, crash), since nothing else can stop an orphaned backend.
const hostPid = Number(process.env.T3CODE_MIRIN_HOST_PID);
const POLL_MS = 2000;

if (Number.isInteger(hostPid) && hostPid > 0) {
  setInterval(() => {
    if (process.ppid !== hostPid) process.exit(0);
  }, POLL_MS).unref();
}
