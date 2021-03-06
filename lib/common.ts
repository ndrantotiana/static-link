import { PathLike } from 'fs'
import { createHash } from "crypto";

export const isWindows = process.platform === 'win32';

import { dirname, normalize, join, resolve, basename, extname } from 'path';
import { constants } from 'os';
import { spawn, SpawnOptions, ChildProcess } from "child_process";

import * as filesystem from 'fs';

// shallow copy original function implementations before we start tweaking.
const fs = { ...filesystem };

// promisify async functions.
export function readdir(path): Promise<Array<string>> {
  return new Promise((r, j) => fs.readdir(path, (err, files) => err ? j(err) : r(files)));
}
export function stat(path): Promise<filesystem.Stats> {
  return new Promise((r, j) => fs.stat(path, (err, files) => err ? j(err) : r(files)));
}
export function lstat(path): Promise<filesystem.Stats> {
  return new Promise((r, j) => fs.lstat(path, (err, files) => err ? j(err) : r(files)));
}
export function open(path: filesystem.PathLike, flags: string | number, mode?: string | number | undefined | null): Promise<number> {
  return new Promise((r, j) => fs.open(path, flags, mode, (err, descrpitor) => err ? j(err) : r(descrpitor)));
}
export function close(fd: number): Promise<void> {
  return new Promise((r, j) => fs.close(fd, (err) => err ? j(err) : r()));
}
export function write(fd: number, buffer: Buffer, offset?: number, length?: number, position?: number): Promise<number> {
  return new Promise((r, j) => fs.write(fd, buffer, offset || 0, length || buffer.length, position || undefined, (err, written, buf) => err ? j(err) : r(written)));
}
export function read(fd: number, buffer: Buffer, offset: number, length: number, position?: number): Promise<number> {
  return new Promise((r, j) => fs.read(fd, buffer, offset, length, position || null, (err, bytes, buffer) => err ? j(err) : r(bytes)));
}
export function readFile(path: filesystem.PathLike, options?: { encoding?: string | null; flag?: string; }): Promise<string | Buffer> {
  return new Promise((r, j) => fs.readFile(path, options, (err, data) => err ? j(err) : r(data)));
}
export function execute(command: string, cmdlineargs: string[], options: SpawnOptions): Promise<{ stdout: string, stderr: string, error: Error | null, code: number }> {
  return new Promise((r, j) => {
    const cp = spawn(command, cmdlineargs, { ...options, stdio: "pipe" });
    let err = "";
    let out = "";
    cp.stderr.on("data", (chunk) => { err += chunk; process.stdout.write('.'); });
    cp.stdout.on("data", (chunk) => { out += chunk; process.stdout.write('.'); });
    cp.on("close", (code, signal) => r({ stdout: out, stderr: err, error: code ? new Error("Process Failed.") : null, code: code }));
  });
}
function fs_mkdir(path: string | Buffer): Promise<void> {
  return new Promise((r, j) => fs.mkdir(path, (err) => err ? j(err) : r()))
}

function fs_unlink(path: string | Buffer): Promise<void> {
  return new Promise((r, j) => fs.unlink(path, (err) => err ? j(err) : r()))
}

function fs_rmdir(path: string | Buffer): Promise<void> {
  return new Promise((r, j) => fs.rmdir(path, (err) => err ? j(err) : r()))
}

export function rename(oldPath: string, newPath: string): Promise<void> {
  return new Promise((r, j) => fs.rename(oldPath, newPath, (err) => err ? j(err) : r()))
}
export function writeFile(filename: string, content: string): Promise<void> {
  return new Promise((r, j) => fs.writeFile(filename, content, (err) => err ? j(err) : r()))
}

export async function copyFile(source: string, target: string): Promise<void> {
  await mkdir(dirname(target));

  return await new Promise<void>((resolve, reject) => {
    var rd = fs.createReadStream(source);
    rd.on('error', rejectCleanup);

    var wr = fs.createWriteStream(target);
    wr.on('error', rejectCleanup);

    function rejectCleanup(err) {
      rd.destroy();
      wr.end();
      reject(err);
    }

    wr.on('finish', () => {
      rd.close();
      wr.close();
      resolve();
    });
    rd.pipe(wr);
  });
}

export async function copyFolder(source: string, target: string, all?: Array<Promise<void>>): Promise<void> {
  const waitAtEnd = all ? false : true;
  all = all || new Array<Promise<void>>();

  if (isDirectory(source)) {
    for (const each of await readdir(source)) {
      const sp = join(source, each);
      const dp = join(target, each);

      if (await isDirectory(sp)) {
        copyFolder(sp, dp, all);
      } else {
        all.push(copyFile(sp, dp));
      }
    }
  }
  if (waitAtEnd) {
    await Promise.all(all);
  }
};

export const exists: (path: string | Buffer) => Promise<boolean> = path => new Promise<boolean>((r, j) => fs.stat(path, (err: NodeJS.ErrnoException, stats: filesystem.Stats) => err ? r(false) : r(true)));

export async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    if (await exists(dirPath)) {
      return (await lstat(dirPath)).isDirectory();
    }
  } catch (e) {
    // don't throw!
  }
  return false;
}

export async function isFile(filePath: string): Promise<boolean> {
  try {
    if (await exists(filePath)) {
      return !(await lstat(filePath)).isDirectory();
    }
  } catch (e) {
    // don't throw!
  }

  return false;
}

export async function rmdir(dirPath: string) {
  // if it's not there, do nothing.
  if (!await exists(dirPath)) {
    return;
  }

  //if it's not a directory, that's bad.
  if (!await isDirectory(dirPath)) {
    throw new Error(dirPath);
  }

  // make sure this isn't the current directory.
  if (process.cwd() === normalize(dirPath)) {
    process.chdir(`${dirPath}/..`);
  }

  // make sure the folder is empty first.
  const files = await readdir(dirPath);
  if (files.length) {
    const awaiter = new Array<any>();
    try {
      for (const file of files) {
        try {
          const p = join(dirPath, file);

          if (await isDirectory(p)) {
            // folders are recursively rmdir'd 
            awaiter.push(rmdir(p));
          }
          else {
            // files and symlinks are unlink'd 
            awaiter.push(fs_unlink(p).catch(() => { }));
          }
        } catch (e) {
          // uh... can't.. ok.
        }

      }
    } finally {
      // after all the entries are done
      await Promise.all(awaiter);
    }
  }
  try {
    // if this fails for some reason, check if it's important.
    await fs_rmdir(dirPath);
  } catch (e) {
    // is it gone? that's all we really care about.
    if (await isDirectory(dirPath)) {
      // directory did not delete
      throw new Error(`UnableToRemoveException ${dirPath}`);
    }
  }
}

export async function rmFile(filePath: string) {
  // not there? no problem
  if (!exists(filePath)) {
    return;
  }

  // not a file? that's not cool.
  if (await isDirectory(filePath)) {
    throw new Error(`PathIsNotFileException : ${filePath}`);
  }

  try {
    // files and symlinks are unlink'd 
    await fs_unlink(filePath);
  } catch (e) {
    // is it gone? that's all we really care about.
    if (await exists(filePath)) {
      // directory did not delete
      throw new Error(`UnableToRemoveException : filePath`);
    }
  }
}


export async function mkdir(dirPath: string) {
  if (!await isDirectory(dirPath)) {
    const p = normalize(dirPath + "/");
    const parent = dirname(dirPath);
    if (! await isDirectory(parent)) {
      if (p != parent) {
        await mkdir(parent);
      }
    }
    try {
      await fs_mkdir(p);
    } catch (e) {
      if (!await isDirectory(p)) {
        throw new Error(e);
      }
    }
  }
}

// size of integers in file. (node uses 6-byte integers in buffer.)
export const INTSIZE = 6;

function _unixifyPath(filepath: PathLike): string {
  if (filepath && typeof filepath === 'string') {
    return filepath.
      // change \\?\<letter>:\ to <letter>:\ 
      replace(/^\\\\\?\\(.):\\/, '$1:\\').

      // change backslashes to forward slashes. (and remove duplicates)
      replace(/[\\\/]+/g, '/').

      // remove drive letter from front
      replace(/^([a-zA-Z]+:|\.\/)/, '').

      // drop any trailing slash
      replace(/(.+?)\/$/, '$1');
  }
  return <string>filepath;
}

function _isWindowsPath(filepath: string): boolean {
  if (filepath && filepath.length >= 3) {
    if (filepath.charCodeAt(0) === 92 && filepath.charCodeAt(1) === 92) {
      return true;
    }

    if (filepath.charCodeAt(1) == 58 && filepath.charCodeAt(2) === 92) {
      var code = filepath.charCodeAt(0);
      return code >= 65 && code <= 90 || code >= 97 && code <= 122;
    }
  }
  return false;
}

/** Strips down a path into an absolute-style unix path (WIN32 only) */
export const unixifyPath = isWindows ? _unixifyPath : p => p;

export const isWindowsPath = isWindows ? _isWindowsPath : p => p;


export function calculateHash(content: any): string {
  return createHash('sha256').update(JSON.stringify(content)).digest("base64");
}

export function select<T, V>(array: Array<V>, callbackfn: (accumulator: Array<T>, current: V, index: number, array: V[]) => T): Array<T> {
  return array.reduce((p, c, i, a) => { p.push(callbackfn(p, c, i, a)); return p }, new Array<T>());
}

export function selectMany<T, V>(array: Array<V>, callbackfn: (accumulator: Array<T>, current: V, index: number, array: V[]) => Array<T>): Array<T> {
  return array.reduce((p, c, i, a) => { p.push(...callbackfn(p, c, i, a)); return p }, new Array<T>());
}

export function first<T, V>(array: Array<V>, selector: (current: V) => T | undefined, onError: () => undefined = () => undefined): T | undefined {
  for (const each of array) {
    const result = selector(each);
    if (result != undefined) {
      return result
    }
  }
  return onError();
}


export async function backup(filename: string): Promise<() => void> {
  if (!await isFile(filename)) {
    // file doesn't exists, doesn't need restoring.
    return async () => {
      await rmFile(filename);
    };
  }
  const backupFile = join(dirname(filename), `${basename(filename)}.${Math.random() * 10000}${extname(filename)}`);

  // rename then copy preserves the file attributes when we restore.
  await rename(filename, backupFile);
  await copyFile(backupFile, filename);

  return async () => {
    await rmFile(filename);
    await rename(backupFile, filename);
  }
}