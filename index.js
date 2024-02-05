const nodeFs = isNode() ? await import('fs') : undefined;

const RUNTIME_BROWSER = 0;
const RUNTIME_NODE = 1;
const RUNTIME_DENO = 2;
const RUNTIME_BUN = 3;

class File {
  get readable() {
    return this._readable;
  }
}

class BrowserFile extends File {
  constructor(f) {
    super(f);
    this._readable = f.stream();
  }
}

class NodeFile extends File {
  constructor(f) {
    super(f);
    this._readable = f.readableWebStream();
  }
}

class DenoFile extends File {
  constructor(f) {
    super(f);
    this._readable = f.readable;
  }
}

class BunFile extends File {
  constructor(f) {
    super(f);
    this._readable = f.stream();
  }
}

const runtime = detectRuntime();

async function openFile(path) {
  switch (runtime) {
    case RUNTIME_BROWSER: {
      return new Promise((resolve, reject) => {
        const fileInput = document.createElement('input');
        fileInput.setAttribute('type', 'file');
        fileInput.setAttribute('hidden', '');
        document.body.appendChild(fileInput);

        fileInput.addEventListener('change', (evt) => {
          resolve(new BrowserFile(fileInput.files[0]));
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
      const f = await Deno.open(path);
      return new DenoFile(f);
      break;
    }
    case RUNTIME_BUN: {
      const f = Bun.file(path);
      return new BunFile(f);
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
}
