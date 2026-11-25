// v2-only strings layered over NeedsI18n (falls back to the shared dictionary).
(function () {
  var extra = {
    'zh-CN': {
      'cm.new': '新输入',
      'cm.ph': '粘贴邮件、会议记录，或写下新的要求…',
      'cm.hint': '导入后自动识别需求，确认后生效',
      'cm.attach': '导入文件',
      'cm.send': '导入',
      'top.switch': '切换项目'
    },
    en: {
      'cm.new': 'New input',
      'cm.ph': 'Paste an email or meeting notes, or write a new request…',
      'cm.hint': 'Needs are detected on import and take effect once confirmed',
      'cm.attach': 'Import file',
      'cm.send': 'Import',
      'top.switch': 'Switch project'
    }
  };
  var base = window.NeedsI18n.t;
  window.NeedsI18n.t = function (lang, key, vars) {
    var s = extra[lang] && extra[lang][key];
    if (s == null) return base(lang, key, vars);
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  };
})();
