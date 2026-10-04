import { paths } from './env.js';
export const tmpdir = () => paths.temp;
export const release = () => '0.0.0';
export const platform = () => 'android';
export const homedir = () => paths.documents;
export const EOL = '\n';
export default { tmpdir, release, platform, homedir, EOL };
