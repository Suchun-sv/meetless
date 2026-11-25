// UI rule: no dot symbols anywhere. Cleans sample data, translated strings, and any literal
// text children passed to React (so shared components follow the rule too).
(function () {
  var DOTS = /\s*·\s*/g;
  var MASK = /•+/g; // masked secrets: show placeholder letters instead of bullets
  function clean(s) { return s.replace(DOTS, ' ').replace(MASK, 'xxxxxxxx'); }
  function walk(o) {
    if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) o[i] = typeof o[i] === 'string' ? clean(o[i]) : walk(o[i]); return o; }
    if (o && typeof o === 'object') { Object.keys(o).forEach(function (k) { o[k] = typeof o[k] === 'string' ? clean(o[k]) : walk(o[k]); }); }
    return o;
  }
  walk(window.NeedsProjects); walk(window.NeedsExtra); walk(window.NeedsCollab);
  var base = window.NeedsI18n.t;
  window.NeedsI18n.t = function (lang, key, vars) { return clean(base(lang, key, vars)); };
  var ce = React.createElement;
  React.createElement = function () {
    var args = Array.prototype.slice.call(arguments);
    for (var i = 2; i < args.length; i++) if (typeof args[i] === 'string') args[i] = args[i].replace(DOTS, ' ').replace(MASK, 'xxxxxxxx');
    return ce.apply(this, args);
  };
})();
