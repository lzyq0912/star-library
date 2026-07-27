const MIN_MAJOR = 22;
const MIN_MINOR = 13;

function assertSupportedNodeVersion() {
  const [major = 0, minor = 0] = String(process.versions.node || '0.0').split('.').map(Number);
  if (major > MIN_MAJOR || (major === MIN_MAJOR && minor >= MIN_MINOR)) return;
  throw new Error(
    `QMReader requires Node.js ${MIN_MAJOR}.${MIN_MINOR}.0 or newer because it uses the stable node:sqlite API. Current runtime: ${process.versions.node}. Install Node 24 LTS.`,
  );
}

module.exports = { assertSupportedNodeVersion };
