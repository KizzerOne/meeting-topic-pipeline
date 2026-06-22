export let projectRoot = process.cwd();
export let options = {};

export function setContext(root, opts) {
  projectRoot = root;
  options = opts;
}
