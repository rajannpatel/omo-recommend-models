let progressClackState = { useClackPrompts: false, clack: null };

export function setProgressClackState(useClackPrompts, clack) {
  progressClackState = { useClackPrompts: Boolean(useClackPrompts), clack };
}

export function createProgress(label) {
  if (progressClackState.useClackPrompts && progressClackState.clack?.spinner) {
    const spinner = progressClackState.clack.spinner();
    spinner.start(label);
    return {
      update(message) {
        spinner.message(`${label}: ${message}`);
      },
      done(message = "done") {
        spinner.stop(`${label}: ${message}`);
      },
      skip(message) {
        spinner.stop(`${label}: ${message}`);
      },
    };
  }

  const start = Date.now();
  process.stdout.write(`  ⏳ ${label}...`);
  return {
    update(message) {
      process.stdout.write(`\r  ⏳ ${label}: ${message}\x1b[K`);
    },
    done(message = "done") {
      const elapsed = Math.max(0, Math.round((Date.now() - start) / 1000));
      process.stdout.write(`\r  ✓ ${label}: ${message} (${elapsed}s)\x1b[K\n`);
    },
    skip(message) {
      process.stdout.write(`\r  • ${label}: ${message}\x1b[K\n`);
    },
  };
}
