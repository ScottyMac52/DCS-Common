const stableVersionPattern = /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)$/;
const semVerPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function resolvePackageVersion(version) {
  const resolved = String(version ?? '').trim() || '0.0.0-local';
  if (!semVerPattern.test(resolved)) {
    throw new Error(`Invalid package version '${resolved}'. Expected a semantic version without a leading v.`);
  }
  return resolved;
}

export function getNextVersion(currentVersion, bump) {
  const match = stableVersionPattern.exec(String(currentVersion ?? '').trim());
  if (!match) {
    throw new Error(`Invalid current version '${currentVersion}'. Expected MAJOR.MINOR.PATCH.`);
  }
  if (!['patch', 'minor', 'major'].includes(bump)) {
    throw new Error(`Invalid version bump '${bump}'. Expected patch, minor, or major.`);
  }

  let major = Number(match.groups.major);
  let minor = Number(match.groups.minor);
  let patch = Number(match.groups.patch);

  if (bump === 'patch') patch += 1;
  if (bump === 'minor') { minor += 1; patch = 0; }
  if (bump === 'major') { major += 1; minor = 0; patch = 0; }

  return `${major}.${minor}.${patch}`;
}

const [command, ...args] = process.argv.slice(2);
if (command) {
  try {
    if (command === 'resolve') console.log(resolvePackageVersion(args[0]));
    else if (command === 'next') console.log(getNextVersion(args[0], args[1]));
    else throw new Error(`Unknown version command '${command}'.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
