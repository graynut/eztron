const path = require("path");
const fs = require('fs/promises');
const Rollup = require("rollup");
const terser = require("@rollup/plugin-terser");
const { nodeResolve } = require("@rollup/plugin-node-resolve");


// noble 编译插件
function fixNobleCode() {
  return {
    name: 'fixNobleCode',
    generateBundle(_, bundle) {
      const output = bundle['noble.js'];
      output.code = output.code.replace("to = to;", "")
    },
  };
}


// ethers 编译插件
function fixEthersCode() {
  const nobel = '_TRON_GRIDE_EXTRAL_NOBEL_';
  const nodePackages = new Set([
    'crypto', 'http', 'https', 'zlib',
  ]);
  return {
    name: 'fixEthersCode',
    resolveId(source) {
      if (source.startsWith('@noble')) {
        return source;
      }
      if (source === nobel || nodePackages.has(source)) {
        return false;
      }
      return null;
    },
    load(id) {
      if (id.startsWith('@noble')) {
        return 'export * from "'+nobel+'"';
      }
    },
    generateBundle(_, bundle) {
      const output = bundle['ethers.js'];
      output.code = output.code.replace(
        `'${nobel}'`, 
        "'./noble'"
      ).replace(
        `"${nobel}"`, 
        '"./noble"'
      ).replace(
        "https:/\\/github.com",
        "https://github.com"
      );
    },
  };
}


// 编译 nobel/ethers
async function build(package) {
  const plugins = [];
  if (package === 'noble') {
    plugins.push( fixNobleCode() );
  } else {
    plugins.push( fixEthersCode() );
  }

  // 加载 node_modules
  plugins.push( nodeResolve() );

  // 压缩
  plugins.push( terser() );

  /** @type {Rollup.RollupBuild} */
  let bundle, buildFailed = false;
  try {
    bundle = await Rollup.rollup({
      input: path.join(__dirname, package + ".js"),
      plugins,
    });
    await bundle.write({
      file: path.join(__dirname, "../src/protocol/" + package + ".js"),
      format: "cjs",
    
    });
  } catch (error) {
    buildFailed = true;
    console.error('出错了', error);
  }
  if (bundle) {
    await bundle.close();
  }
  if (buildFailed) {
    process.exit(1);
  }
}



// 复制最新的 protocol
async function copyProto() {
  const src = path.join(__dirname, '../node_modules/tronweb/lib/commonjs/protocol');
  const dest = path.join(__dirname, '../src/protocol');
  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(src, dest, {recursive: true});
}


// 编译
void (async () => {
  await copyProto();
  await build('noble');
  await build('ethers');
})();
