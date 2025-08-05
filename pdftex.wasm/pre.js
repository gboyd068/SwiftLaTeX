const TEXCACHEROOT = "/tex";
const WORKROOT = "/work";
var Module = {};
self.memlog = "";
self.initmem = undefined;
self.mainfile = "main.tex";
self.texlive_endpoint = "https://texlive2.swiftlatex.com/";
Module['print'] = function(a) {
    self.memlog += (a + "\n");
};

Module['printErr'] = function(a) {
    self.memlog += (a + "\n");
    console.log(a);
};

Module['preRun'] = function() {
    FS.mkdir(TEXCACHEROOT);
    FS.mkdir(WORKROOT);
};

function _allocate(content) {
    let res = _malloc(content.length);
    HEAPU8.set(new Uint8Array(content), res);
    return res; 
}

function dumpHeapMemory() {
    var src = wasmMemory.buffer;
    var dst = new Uint8Array(src.byteLength);
    dst.set(new Uint8Array(src));
    // console.log("Dumping " + src.byteLength);
    return dst;
}

function restoreHeapMemory() {
    if (self.initmem) {
        var dst = new Uint8Array(wasmMemory.buffer);
        dst.set(self.initmem);
    }
}

function closeFSStreams() {
    for (var i = 0; i < FS.streams.length; i++) {
        var stream = FS.streams[i];
        if (!stream || stream.fd <= 2) {
            continue;
        }
        FS.close(stream);
    }
}

function prepareExecutionContext() {
    self.memlog = '';
    restoreHeapMemory();
    closeFSStreams();
    FS.chdir(WORKROOT);
}

Module['postRun'] = function() {
    self.postMessage({
        'result': 'ok',
    });
    self.initmem = dumpHeapMemory();
};

function cleanDir(dir) {
    let l = FS.readdir(dir);
    for (let i in l) {
        let item = l[i];
        if (item === "." || item === "..") {
            continue;
        }
        item = dir + "/" + item;
        let fsStat = undefined;
        try {
            fsStat = FS.stat(item);
        } catch (err) {
            console.error("Not able to fsstat " + item);
            continue;
        }
        if (FS.isDir(fsStat.mode)) {
            cleanDir(item);
        } else {
            try {
                FS.unlink(item);
            } catch (err) {
                console.error("Not able to unlink " + item);
            }
        }
    }

    if (dir !== WORKROOT) {
        try {
            FS.rmdir(dir);
        } catch (err) {
            console.error("Not able to top level " + dir);
        }
    }
}


function listDir(dir) {
    let l = FS.readdir(dir);
    for (let i in l) {
        let item = l[i];
        if (item === "." || item === "..") {
            continue;
        }
        console.log(item)
    }
}


Module['onAbort'] = function() {
    self.memlog += 'Engine crashed';
    self.postMessage({
        'result': 'failed',
        'status': -254,
        'log': self.memlog,
        'cmd': 'compile'
    });
    return;
};

async function compileLaTeXRoutine() {
    prepareExecutionContext();
    const setMainFunction = cwrap('setMainEntry', 'number', ['string']);
    setMainFunction(self.mainfile);
    let status = await ccall("compileLaTeX", "number", [], [], {async: true})
    if (status === 0) {
        let pdfArrayBuffer = null;
        // _compileBibtex();
        try {
            let pdfurl = WORKROOT + "/" + self.mainfile.substr(0, self.mainfile.length - 4) + ".pdf";
            pdfArrayBuffer = FS.readFile(pdfurl, {
                encoding: 'binary'
            });
        } catch (err) {
            console.error("Fetch content failed. compilelatex");
            status = -253;
            self.postMessage({
                'result': 'failed',
                'status': status,
                'log': self.memlog,
                'cmd': 'compile'
            });
            return;
        }
        self.postMessage({
            'result': 'ok',
            'status': status,
            'log': self.memlog,
            'pdf': pdfArrayBuffer.buffer,
            'cmd': 'compile'
        }, [pdfArrayBuffer.buffer]);
    } else {
        console.error("Compilation failed, with status code " + status);
        self.postMessage({
            'result': 'failed',
            'status': status,
            'log': self.memlog,
            'cmd': 'compile'
        });
    }
}

async function compileFormatRoutine() {
    prepareExecutionContext();
    FS.unlink(WORKROOT+"/main.tex")
    let status = await ccall("compileFormat", "number", [], [], {async: true})
    if (status === 0) {
        let pdfArrayBuffer = null;
        try {
            let pdfurl = WORKROOT + "/pdflatex.fmt";
            pdfArrayBuffer = FS.readFile(pdfurl, {
                encoding: 'binary'
            });
            console.log("SUCCESSFULLY COMPILED THE FORMAT")
        } catch (err) {
            console.error("Fetch content failed. compileformat");
            status = -253;
            self.postMessage({
                'result': 'failed',
                'status': status,
                'log': self.memlog,
                'cmd': 'compile'
            });
            return;
        }
        self.postMessage({
            'result': 'ok',
            'status': status,
            'log': self.memlog,
            'pdf': pdfArrayBuffer.buffer,
            'cmd': 'compile'
        }, [pdfArrayBuffer.buffer]);
    } else {
        console.error("Compilation format failed, with status code " + status);
        console.log(FS.readFile(WORKROOT+"/pdflatex.log", {encoding: 'utf8'}))
        self.postMessage({
            'result': 'failed',
            'status': status,
            'log': self.memlog,
            'cmd': 'compile'
        });
    }
}

function mkdirRoutine(dirname) {
    try {
        //console.log("removing " + item);
        FS.mkdir(WORKROOT + "/" + dirname);
        self.postMessage({
            'result': 'ok',
            'cmd': 'mkdir'
        });
    } catch (err) {
        console.error("Not able to mkdir " + dirname);
        self.postMessage({
            'result': 'failed',
            'cmd': 'mkdir'
        });
    }
}

function writeFileRoutine(filename, content) {
    try {
        FS.writeFile(WORKROOT + "/" + filename, content);
        self.postMessage({
            'result': 'ok',
            'cmd': 'writefile'
        });
    } catch (err) {
        console.error("Unable to write mem file");
        self.postMessage({
            'result': 'failed',
            'cmd': 'writefile'
        });
    }
}

function writeTexFileRoutine(filename, content) {
    try {
        FS.writeFile(TEXCACHEROOT + "/" + filename, content);
        self.postMessage({
            'result': 'ok',
            'cmd': 'writetexfile'
        });
    } catch (err) {
        console.error("Unable to write mem file");
        self.postMessage({
            'result': 'failed',
            'cmd': 'writetexfile'
        });
    }
}

function transferTexFileToHost(filename) {
    try { 
        let content = FS.readFile(TEXCACHEROOT + "/" + filename, {
            encoding: 'binary'
        });
        self.postMessage({
            'result': 'ok',
            'cmd': 'fetchfile',
            'filename': filename,
            'content': content
        }, [content.buffer]);
    } catch (err) {
        console.error("Unable to fetch mem file");
        self.postMessage({
            'result': 'failed',
            'cmd': 'fetchfile'
        });
    }
}

function transferCacheDataToHost() {
    try {
    self.postMessage({
        'result': 'ok',
        'cmd': 'fetchcache',
        'texlive404_cache': texlive404_cache,
        'texlive200_cache': texlive200_cache,
        'pk404_cache': pk404_cache,
        'pk200_cache': pk200_cache,
    });
    } catch (err) {
        console.error("Unable to fetch cache");
        self.postMessage({
            'result': 'failed',
            'cmd': 'fetchcache'
        });
    }
}

function setTexliveEndpoint(url) {
    if(url) {
        if (!url.endsWith("/")) {
            url += '/';
        }
        self.texlive_endpoint = url;
    }
}

self['onmessage'] = async function(ev) {
    let data = ev['data'];
    let cmd = data['cmd'];
    if (cmd === 'compilelatex') {
        await compileLaTeXRoutine();
    } else if (cmd === 'compileformat') {
        await compileFormatRoutine();
    } else if (cmd === "settexliveurl") {
        setTexliveEndpoint(data['url']);
    } else if (cmd === "mkdir") {
        mkdirRoutine(data['url']);
    } else if (cmd === "writefile") {
        writeFileRoutine(data['url'], data['src']);
    } else if (cmd === "setmainfile") {
        self.mainfile = data['url'];
    } else if (cmd === "grace") {
        console.error("Gracefully Close");
        self.close();
    } else if (cmd === "flushcache") {
        cleanDir(WORKROOT);
    } else if (cmd === "fetchfile") {
        transferTexFileToHost(data['filename']);
    } else if (cmd === "fetchcache") {
        transferCacheDataToHost();
    } else if (cmd === "writetexfile") {
        writeTexFileRoutine(data['url'], data['src']); 
    } else if (cmd === "writecache") {
        texlive404_cache = data['texlive404_cache'];
        texlive200_cache = data['texlive200_cache'];
        pk404_cache = data['pk404_cache'];
        pk200_cache = data['pk200_cache'];
    } 
    else if (cmd === "sendCTANFiles") {
        const id = data.id;
        const error = data.error;
        const result = data.result;
        const { resolve, reject } = pending.get(id);
        pending.delete(id);
        error ? reject(error) : resolve(result);
    }
     else {
        console.error("Unknown command " + cmd);
    }
};


let msgId = 0;
const pending = new Map();

function requestMainToDownloadCTANFiles(filename) {
  return new Promise((resolve, reject) => {
    let id = msgId++;
    pending.set(id, { resolve, reject });
    // console.log("pre: sending download from CTAN", filename);
    self.postMessage({
        'cmd': 'downloadFromCTAN',
        'filename': filename,
        'id': id
    });
  });
}




let texlive404_cache = {};
let texlive200_cache = {};


async function kpse_find_file_impl(nameptr, format, _mustexist) {

    var reqname = UTF8ToString(nameptr);
    if (reqname.includes("/")) {
        return 0;
    }
    if (!(reqname.includes("."))) {
        reqname = reqname + formatToSuffix(format);
    }
    const cacheKey = format + "/" + reqname;    
    // console.log(cacheKey);

    // if (cacheKey in texlive404_cache) {
    //     return 0;
    // }

    if (cacheKey in texlive200_cache) {
        const cachedpath = texlive200_cache[cacheKey];
        return _allocate(intArrayFromString(cachedpath));
    }
    
    try {
        let result = await requestMainToDownloadCTANFiles(reqname);
        if (result === undefined) {
            return 0;
        }
        // console.log(result)
        if (!result.has(reqname)) {
            // throw Error(`required file ${reqname} not downloaded successfully`);
            return 0;
        }
        for (const [filename, content] of result.entries()) {
            // console.log("trying to write", filename)
            const savepath = TEXCACHEROOT + "/" + filename;
            FS.writeFile(savepath, new Uint8Array(content));
            texlive200_cache[cacheKey] = savepath;
            console.log(`successfully fetched ${filename}`)
        }
        const savepath = TEXCACHEROOT + "/" + reqname;
        // texlive200_cache[cacheKey] = savepath;
        return _allocate(intArrayFromString(savepath));
    } catch (err) {
        console.error(err)
        return 0;
    }
}


let pk404_cache = {};
let pk200_cache = {};

async function kpse_find_pk_impl(nameptr, dpi) {
    const reqname = UTF8ToString(nameptr);

    if (reqname.includes("/")) {
        return 0;
    }

    const cacheKey = dpi + "/" + reqname ;

    if (cacheKey in pk404_cache) {
        return 0;
    }

    if (cacheKey in pk200_cache) {
        const savepath = pk200_cache[cacheKey];
        return _allocate(intArrayFromString(savepath));
    }

    try {
        let result = await requestMainToDownloadCTANFiles(reqname);
        if (result === undefined) {
            return 0;
        }
        // console.log(result)
        if (!result.has(reqname)) {
            // throw Error(`required file ${reqname} not downloaded successfully`);
            return 0;
        }
        for (const [filename, content] of result.entries()) {
            console.log("trying to write", filename)
            const savepath = TEXCACHEROOT + "/" + filename;
            FS.writeFile(savepath, new Uint8Array(content));
            texlive200_cache[cacheKey] = savepath;
            console.log(`successfully wrote ${filename}`)
        }
        const savepath = TEXCACHEROOT + "/" + reqname;
        // texlive200_cache[cacheKey] = savepath;
        return _allocate(intArrayFromString(savepath));
    } catch (err) {
        console.error(err)
        return 0;
    }

}

// this was the only way to send these functions to c that worked for me
Module['kpse_find_file_impl'] = kpse_find_file_impl;
Module['kpse_find_pk_impl'] = kpse_find_pk_impl;

// lookups for file formats
const kpse_file_format_type = Object.freeze({
  kpse_gf_format: 0,
  kpse_pk_format: 1,
  kpse_any_glyph_format: 2,
  kpse_tfm_format: 3,
  kpse_afm_format: 4,
  kpse_base_format: 5,
  kpse_bib_format: 6,
  kpse_bst_format: 7,
  kpse_cnf_format: 8,
  kpse_db_format: 9,
  kpse_fmt_format: 10,
  kpse_fontmap_format: 11,
  kpse_mem_format: 12,
  kpse_mf_format: 13,
  kpse_mfpool_format: 14,
  kpse_mft_format: 15,
  kpse_mp_format: 16,
  kpse_mppool_format: 17,
  kpse_mpsupport_format: 18,
  kpse_ocp_format: 19,
  kpse_ofm_format: 20,
  kpse_opl_format: 21,
  kpse_otp_format: 22,
  kpse_ovf_format: 23,
  kpse_ovp_format: 24,
  kpse_pict_format: 25,
  kpse_tex_format: 26,
  kpse_texdoc_format: 27,
  kpse_texpool_format: 28,
  kpse_texsource_format: 29,
  kpse_tex_ps_header_format: 30,
  kpse_troff_font_format: 31,
  kpse_type1_format: 32,
  kpse_vf_format: 33,
  kpse_dvips_config_format: 34,
  kpse_ist_format: 35,
  kpse_truetype_format: 36,
  kpse_type42_format: 37,
  kpse_web2c_format: 38,
  kpse_program_text_format: 39,
  kpse_program_binary_format: 40,
  kpse_miscfonts_format: 41,
  kpse_web_format: 42,
  kpse_cweb_format: 43,
  kpse_enc_format: 44,
  kpse_cmap_format: 45,
  kpse_sfd_format: 46,
  kpse_opentype_format: 47,
  kpse_pdftex_config_format: 48,
  kpse_lig_format: 49,
  kpse_texmfscripts_format: 50,
  kpse_lua_format: 51,
  kpse_fea_format: 52,
  kpse_cid_format: 53,
  kpse_mlbib_format: 54,
  kpse_mlbst_format: 55,
  kpse_clua_format: 56,
  kpse_ris_format: 57,
  kpse_bltxml_format: 58,
  kpse_last_format: 59
});

function formatToSuffix(format) {
    switch (format) {
        case kpse_file_format_type.kpse_gf_format:
            return ".gf";
        case kpse_file_format_type.kpse_pk_format:
            return ".pk";
        case kpse_file_format_type.kpse_tfm_format:
            return ".tfm";
        case kpse_file_format_type.kpse_afm_format:
            return ".afm";
        case kpse_file_format_type.kpse_base_format:
            return ".base";
        case kpse_file_format_type.kpse_bib_format:
            return ".bib";
        case kpse_file_format_type.kpse_bst_format:
            return ".bst";
        case kpse_file_format_type.kpse_fontmap_format:
            return ".map";
        case kpse_file_format_type.kpse_mem_format:
            return ".mem";
        case kpse_file_format_type.kpse_mf_format:
            return ".mf";
        case kpse_file_format_type.kpse_mft_format:
            return ".mft";
        case kpse_file_format_type.kpse_mfpool_format:
            return ".pool";
        case kpse_file_format_type.kpse_mp_format:
            return ".mp";
        case kpse_file_format_type.kpse_mppool_format:
            return ".pool";
        case kpse_file_format_type.kpse_ocp_format:
            return ".ocp";
        case kpse_file_format_type.kpse_ofm_format:
            return ".ofm";
        case kpse_file_format_type.kpse_opl_format:
            return ".opl";
        case kpse_file_format_type.kpse_otp_format:
            return ".otp";
        case kpse_file_format_type.kpse_ovf_format:
            return ".ovf";
        case kpse_file_format_type.kpse_ovp_format:
            return ".ovp";
        case kpse_file_format_type.kpse_pict_format:
            return ".esp";
        case kpse_file_format_type.kpse_tex_format:
            return ".tex";
        case kpse_file_format_type.kpse_texpool_format:
            return ".pool";
        case kpse_file_format_type.kpse_texsource_format:
            return ".dtx";
        case kpse_file_format_type.kpse_type1_format:
            return ".pfa";
        case kpse_file_format_type.kpse_vf_format:
            return ".vf";
        case kpse_file_format_type.kpse_ist_format:
            return ".ist";
        case kpse_file_format_type.kpse_truetype_format:
            return ".ttf";
        case kpse_file_format_type.kpse_type42_format:
            return ".t42";
        case kpse_file_format_type.kpse_miscfonts_format:
        case kpse_file_format_type.kpse_enc_format:
            return ".enc";
        case kpse_file_format_type.kpse_cmap_format:
            return "cmap";
        case kpse_file_format_type.kpse_sfd_format:
            return ".sfd";
        case kpse_file_format_type.kpse_opentype_format:
            return ".otf";
        case kpse_file_format_type.kpse_pdftex_config_format:
            return ".cfg";
        case kpse_file_format_type.kpse_lig_format:
            return ".lig";
        case kpse_file_format_type.kpse_texmfscripts_format:
            // Todo
        case kpse_file_format_type.kpse_fea_format:
            return ".fea";
        case kpse_file_format_type.kpse_cid_format:
            return ".cid";
        case kpse_file_format_type.kpse_mlbib_format:
            return ".mlbib";
        case kpse_file_format_type.kpse_mlbst_format:
            return ".mlbst";
        case kpse_file_format_type.kpse_ris_format:
            return ".ris";
        case kpse_file_format_type.kpse_bltxml_format:
            return ".bltxml";
        case kpse_file_format_type.kpse_fmt_format:
            return ".fmt";
        default:
            console.log(`Unknown Kpse Format ${format}`);
    }
}

