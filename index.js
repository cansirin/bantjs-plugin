var fs = require('fs');
var defined = require('defined');
var pack = require('browser-pack');
var xtend = require('xtend');
var normalize = require('bant-normalize');
var factor = require('bant-factor');
var debug = require('debug')('bant:plugin');
var path = require('path');
var through = require('through2');

module.exports = function (b, opts) {
  if (!opts) opts = {};

  if (!Array.isArray(opts.modules) || !opts.modules.length) {
    debug('missing modules');
    return b;
  }

  opts = xtend(opts, {
    basedir: defined(opts.basedir, b._options.basedir),
    pack: xtend(b._options, { raw: true, hasExports: true }),
    outputs: defined(opts.outputs, {}),
    resolveMap: defined(opts.resolveMap, {}),
    threshold: defined(opts.threshold, 1)
  });

  var externals = [],
      mIndex = {};

  var modules = opts.modules.map(function (file) {
    var obj = require(require.resolve(file));
    obj.basedir = defined(obj.basedir, opts.basedir, path.dirname(file));
    return obj;
  });

  modules = normalize(modules, xtend(opts, { asString: false }));

  modules.forEach(function (obj) {
    mIndex[obj.expose] = obj;
    if (obj._external) {
      b.require(obj._entry, {
        entry: true,
        expose: obj.expose,
        basedir: obj.basedir
      });
    }
  });

  b._bpack.hasExports = true;

  b.on('reset', reset);

  function reset () {
    b.pipeline.get('record').push(through.obj(function (row, enc, cb) {
      if (row.file) {
        var m = mIndex[row.id];
        if (m && m._external) {
          m._record = row;
          externals.push(m);
        }
      }
      cb(null, row);
    }, function (cb) {
      externals.forEach(function (obj) {
        var output = opts.outputs[obj.name];
        if (output) {
          var ws = 'function' === typeof output
            ? output()
            : (isStream(output) ? output : fs.createWriteStream(output));
          var m = mIndex[obj.expose];
          m._ws = pack(opts.pack);
          m._ws.pipe(ws);
        }
      });

      var files = externals.reduce(function (acc, x) {
        acc[x._record.file] = x;
        return acc;
      }, {});

      var tr = factor({
        files: files,
        resolveMap: opts.resolveMap,
        threshold: opts.threshold
      });

      tr.on('stream', function (bundle) {
        bundle.pipe(files[bundle.file]._ws);
      });

      b.pipeline.get('pack').unshift(tr);

      cb();
    }));

    b.pipeline.get('label').push(through.obj(function (row, enc, cb) {
      opts.resolveMap[row.id] = path.resolve(opts.basedir, row.file);
      cb(null, row);
    }));
  }

  reset();

  return b;
};

function isStream (s) { return s && typeof s.pipe === 'function' }