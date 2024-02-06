const RUNTIME_BROWSER = 0;
const RUNTIME_NODE = 1;
const RUNTIME_DENO = 2;
const RUNTIME_BUN = 3;

const runtime = detectRuntime();

const nodePath = runtime === RUNTIME_NODE ?
  await import('path') : undefined;
const denoPath = runtime === RUNTIME_DENO ?
  await import("https://deno.land/std@0.214.0/path/mod.ts") : undefined;
const nodeFs = isNode() ? await import('fs') : undefined;


class File {
  constructor(f, start, end) {
    this._file = f;
    this._start = start;
    this._end = end;
    this._size = end - start;
  }

  get size() {
    return this._size;
  }

  stream() {
    throw new Error("Must implement stream()");
  }

  slice() {
    throw new Error("Must implement slice()");
  }
}

class DirectoryTree {
  constructor(rootPath) {
    this._rootPath = rootPath;
  }

  async openFile(path) {
    throw new Error("Must implement openFile()");
  }
}

class NodeFile extends File { 

  constructor(f, start, end) {
    super(f, start, end);
  }

  slice(start, end, contentType) {
    return new NodeFile(this._file, start ? start : this._start, end ? end : this._end);
  }

  stream() {
    const nodeStream = this._file.createReadStream({
      start: this._start,
      end: this._end,
    });

    let done = false;
    let controller;

    const rs = new ReadableStream({

      async start(contr) {
        controller = contr;
      },

      pull(contr) {
        if (contr.desiredSize > 0) {
          nodeStream.resume();
        }
      },

      cancel() {
        nodeStream.close();
        done = true;
      }

    });

    nodeStream.on('data', (chunk) => {
      if (controller.desiredSize > 0) {
        controller.enqueue(chunk);
      }
      else {
        nodeStream.pause();
      }
    });

    nodeStream.on('close', (chunk) => {
      if (!done) {
        controller.close();
        done = true;
      }
    });

    return rs;
  }
}

class DenoFile extends File {
  constructor(f, start, end) {
    super(f, start, end);
  }

  slice(start, end, contentType) {
    return new DenoFile(this._file, start ? start : this._start, end ? end : this._end);
  }

  stream() {

    const self = this;

    if (this._start !== undefined) {
      return new ReadableStream({

        async start(controller) {
          await self._file.seek(self._start, Deno.SeekMode.Start);
          self._reader = self._file.readable.getReader();

        },

        async pull(controller) {
          const { value, done } = await self._reader.read();
          if (done) {
            controller.close();
          }
          else {
            controller.enqueue(value);
          }
        }
      });
    }
    else {
      return this._file.readable;
    }
  }
}

class BunFile extends File {
  constructor(f) {
    super(f);

    this._file = f;
    this._readable = f.stream();
  }

  slice(start, end, contentType) {
    return this._file.slice(start, end, contentType);
  }
}

class BrowserDirectoryTree extends DirectoryTree {
  constructor() {
    const rootPath = '/';
    super(rootPath);

    this._files = {};
  }

  async openFile(path) {
    if (this._files[path] !== undefined) {
      return this._files[path];
    }
    else {
      throw new Error("No such file", path);
    }
  }

  async addFiles() {
    const files = await new Promise((resolve, reject) => {
      const fileInput = document.createElement('input');
      fileInput.setAttribute('type', 'file');
      fileInput.setAttribute('hidden', '');
      fileInput.setAttribute('multiple', '');
      document.body.appendChild(fileInput);

      fileInput.addEventListener('change', (evt) => {
        resolve(fileInput.files);
        document.body.removeChild(fileInput);
      });

      fileInput.click();
    });

    for (const file of files) {
      this._files['/' + file.name] = file;
    }

    return files;
  }
}

class NodeDirectoryTree extends DirectoryTree {
  constructor(rootPath) {
    super(rootPath);
  }

  // TODO: CRITICAL: path security
  async openFile(path) {
    const absPath = nodePath.join(this._rootPath, path);
    const f = await nodeFs.promises.open(absPath); 
    const fileInfo = await f.stat();
    return new NodeFile(f, 0, fileInfo.size);
  }
}

class DenoDirectoryTree extends DirectoryTree {
  constructor(rootPath) {
    super(rootPath);
  }

  async openFile(path) {
    const absPath = denoPath.join(this._rootPath, path);
    const f = await Deno.open(absPath, { read: true, write: false });
    const fileInfo = await f.stat();
    return new DenoFile(f, 0, fileInfo.size);
  }
}


async function openFile(path) {
  switch (runtime) {
    case RUNTIME_BROWSER: {
      return new Promise((resolve, reject) => {
        const fileInput = document.createElement('input');
        fileInput.setAttribute('type', 'file');
        fileInput.setAttribute('hidden', '');
        document.body.appendChild(fileInput);

        fileInput.addEventListener('change', (evt) => {
          resolve(fileInput.files[0]);
          document.body.removeChild(fileInput);
        });

        fileInput.click();
      });
      break;
    }
    case RUNTIME_NODE: {
      const f = await nodeFs.promises.open(path); 
      return new NodeFile(f);
      break;
    }
    case RUNTIME_DENO: {
      // TODO: need to close the files we're opening
      const f = await Deno.open(path);
      const fileInfo = await f.stat();
      return new DenoFile(f, 0, fileInfo.size);
      break;
    }
    case RUNTIME_BUN: {
      const f = Bun.file(path);
      //return new BunFile(f);
      return f;
      break;
    }
  }
}

async function openDirectory(path) {
  switch (runtime) {
    case RUNTIME_BROWSER: {
      return new BrowserDirectoryTree(path);
      break;
    }
    case RUNTIME_NODE: {
      return new NodeDirectoryTree(path);
      break;
    }
    case RUNTIME_DENO: {
      return new DenoDirectoryTree(path);
      break;
    }
    default: {
      throw new Error("Runtime not implemented:", runtime);
      break;
    }
  }
}

function detectRuntime() {
  let runtime = RUNTIME_BROWSER;
  if (typeof process !== 'undefined' && process.versions.bun !== undefined) {
    runtime = RUNTIME_BUN;
  }
  else if (isNode()) {
    runtime = RUNTIME_NODE;
  }
  else if (window.Deno !== undefined) {
    runtime = RUNTIME_DENO;
  }
  return runtime;
}

function isNode() {
  return (typeof process !== 'undefined' && process.release.name === 'node');
}

export {
  openFile,
  openDirectory,
}
