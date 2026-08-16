/**
 * lor_rules.js — единый закон кабинета «Доктор ЛОР»
 * Версия: 1.2.1
 *
 * *** SEALED / НЕ РЕДАКТИРОВАТЬ без прогона test_lor_rules.py ***
 * Единственный источник правил цвета/базы/печати/курса/цепочки данных.
 * doctor.html только читает LOR_RULES.*, не дублирует закон.
 *
 * Подключение: <script src="lor_rules.js"></script> ПЕРЕД основным скриптом.
 * Автотесты: python test_lor_rules.py  /  run_tests.bat
 *
 * ЗАКОН (кратко):
 *  - Цепочка: окно приёма → Google Calendar + Supabase (правда) → Access (архив).
 *  - Access НЕ источник patient_id и НЕ подтягивается в облако (Access→Supabase выкл.).
 *  - В базу (Supabase, затем архив Access) — ТОЛЬКО цвета 10 (Базилик) и 2 (Шалфей).
 *  - Любой другой цвет → только Google Calendar.
 *  - Запись в базу: только «Сохранить» / «Печать» (не клик по цвету в окне приёма).
 *  - Окно оплаты: только [PAY]/услуга; цвет события — только в окне приёма.
 *  - Данные оплаты НИКОГДА не выводятся на печать бланка.
 *  - Новое ФИО+ДР → новый patient_id; полное совпадение ФИО+ДР → старый id (только Supabase).
 *  - Пустые визиты (Базилик/Шалфей) всё равно пишутся в базу.
 *  - Soft-delete в базе при уходе с 10/2 (событие в GCal остаётся, меняется цвет).
 *  - Курс: день1 = Базилик + оплата + процедуры; дни 2–10 (без пятниц) = Павлин, только процедуры.
 *  - Печать: frozen HTML превью, стили сохраняются.
 *  - Рекомендации: первая после «рек-но…», далее в позицию курсора.
 */
(function (root) {
  'use strict';

  var LOR_RULES = {
    VERSION: '1.2.1',

    /* ---------- цвета ---------- */
    DB_COLORS: ['10', '2'],           // Базилик, Шалфей
    COLOR_BASIL: '10',
    COLOR_SAGE: '2',
    COLOR_PEACOCK: '7',               // Павлин (курс)

    /* ---------- цепочка данных (v1.2) ---------- */
    /**
     * Источник правды и архив.
     * Access на каждом ПК — локальный архив; при смене ПК архив не «догоняет»
     * сам, пока нет job Supabase→Access. Работа ЛК от Access не зависит.
     */
    dataChain: function () {
      return {
        truth: 'supabase',           // patient_id + визиты
        schedule: 'google_calendar',
        archive: 'access',           // D:\\MedicalLog\\db.accdb
        accessReadsForId: false,
        accessToSupabaseSync: false,
        supabaseToAccessJob: false,  // пока нет: архив пишется только при save на этом ПК
        writeDbOnColorClickInVisitForm: false,
        writeDbOnSaveOrPrint: true,
        payModalSetsColor: false
      };
    },

    normColor: function (c) {
      if (c == null || c === 'default' || c === 'null' || c === undefined) return '';
      return String(c).trim();
    },

    isDbColor: function (c) {
      var n = this.normColor(c);
      return n === '10' || n === '2';
    },

    shouldWriteDb: function (c) {
      return this.isDbColor(c);
    },

    /** Куда писать при сохранении события с данным цветом */
    saveTargets: function (c) {
      var n = this.normColor(c);
      return {
        calendar: true,
        db: this.isDbColor(n),
        colorId: n
      };
    },

    /** Уход с базового цвета → soft-delete в базе (GCal-событие НЕ удаляется) */
    shouldSoftDeleteOnColorChange: function (prev, next) {
      return this.isDbColor(prev) && !this.isDbColor(next);
    },

    /** Приход на базовый цвет → сохранить/обновить в базе */
    shouldSaveDbOnColorChange: function (prev, next) {
      return this.isDbColor(next);
    },

    /** Оплата учитывается в выручке только у Базилика */
    paymentCountsInRevenue: function (c) {
      return this.normColor(c) === '10';
    },

    /* ---------- длительности ---------- */
    visitDurationMinutes: function () { return 15; },
    taskDurationMinutes: function () { return 30; },

    /* ---------- служебные события ---------- */
    isServiceSummary: function (s) {
      s = String(s || '').trim();
      if (!s) return false;
      if (/^контроль:/i.test(s)) return true;
      if (/^\[LOR_TASK\]/i.test(s)) return true;
      if (s === 'T K') return true;
      if (/^выручк/i.test(s)) return true;
      return false;
    },

    /* ---------- оплата ---------- */
    PAY_MIN_AMOUNT: 500,

    parsePayment: function (text, opts) {
      opts = opts || {};
      var anyAmount = !!opts.anyAmount;
      var t = String(text || '').replace(/\r/g, '\n');
      t = t.replace(/<br\s*\/?>/gi, '\n').replace(/&nbsp;/g, ' ');
      var minAmt = anyAmount ? 0 : this.PAY_MIN_AMOUNT;

      function normMethod(m) {
        m = String(m || '').toLowerCase();
        if (m === 'н') return 'нал';
        if (m === 'нт') return 'нат';
        return m || 'сумма';
      }

      function cand(method, digits, tys, raw) {
        var amount = parseInt(String(digits || '').replace(/[^\d]/g, '') || '0', 10);
        if (tys && /тыс/i.test(tys) && amount > 0 && amount < 1000) amount *= 1000;
        if (amount < minAmt && !anyAmount) return null;
        if (amount <= 0) return null;
        return { method: normMethod(method), amount: amount, raw: raw };
      }

      var cands = [];
      var rePay = /\[PAY\]\s*(айз|адл|нат|айж|нал|нт|кк|cash|card|\bн)?\s*[:\-]?\s*([0-9][0-9\s\xa0]*[0-9]|[0-9]+)(\s*тыс\.?)?/gi;
      var m;
      while ((m = rePay.exec(t)) !== null) {
        var c = cand(m[1], m[2], m[3], m[0]);
        if (c) { c.index = m.index; cands.push(c); }
      }
      if (cands.length) {
        cands.sort(function (a, b) { return a.index - b.index; });
        return cands[0];
      }

      var reBare = /(айз|адл|нат|айж|нал|нт|кк|cash|card|\bн)\s*[:\-]?\s*([0-9][0-9\s\xa0]*[0-9]|[0-9]+)(\s*тыс\.?)?/gi;
      while ((m = reBare.exec(t)) !== null) {
        var after = t.slice(m.index + m[0].length, m.index + m[0].length + 12);
        if (/^\s*(мг|мл|таб|кап|ед\.?|шт)/i.test(after)) continue;
        c = cand(m[1], m[2], m[3], m[0]);
        if (c) { c.index = m.index; cands.push(c); }
      }
      if (!cands.length) return null;
      cands.sort(function (a, b) { return a.index - b.index; });
      return cands[0];
    },

    formatPaymentLine: function (method, amount, services) {
      var parts = [];
      method = String(method || '').trim();
      var sumS = String(amount || '').replace(/[^\d]/g, '');
      var svcs = (services || []).filter(Boolean);
      if (method) parts.push(method);
      if (sumS) parts.push(sumS);
      if (svcs.length) parts.push(svcs.join(' '));
      if (!parts.length) return '';
      var line = parts.join(' ');
      return sumS ? ('[PAY] ' + line) : line;
    },

    /* ---------- печать ---------- */
    printPolicy: function () {
      return {
        rebuildPreviewFromForm: false,   // никогда не пересобирать превью из формы
        useFrozenPreviewHtml: true,      // только замороженный HTML
        paymentOnBlank: false            // оплата на бланк НЕ выводится
      };
    },

    /** Убрать оплату/телефоны из HTML перед печатью (закон) */
    stripForPrint: function (html) {
      var h = String(html || '');
      // блок data-vc-pay
      h = h.replace(/<div[^>]*data-vc-pay=["']1["'][^>]*>[\s\S]*?<\/div>/gi, '');
      // строки «адл 39000», «айз 4500 тонз»
      h = h.replace(/(?:<br\s*\/?>|\n|^|>)\s*(?:айз|адл|нат|айж|нал|нт|\bн)\s*[:\-]?\s*[0-9][0-9\s\u00a0]*[0-9]?\s*(?:тыс\.?)?[^<\n]*/gi, function (m) {
        return m.charAt(0) === '>' ? '>' : '';
      });
      // голые суммы + услуга
      h = h.replace(/(?:<br\s*\/?>|\n|^|>)\s*\d{1,3}(?:[\s\u00a0]\d{3})*\s*(?:при[её]м|тонз|кафну|каф|ка\b|кф|пп|пробк|ту|сумма)\b[^<\n]*/gi, function (m) {
        return m.charAt(0) === '>' ? '>' : '';
      });
      // телефоны
      h = h.replace(/(?:\+?7|8)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/g, '');
      h = h.replace(/^(?:\s*<br\s*\/?>\s*)+/i, '');
      return h;
    },

    /* ---------- пациент / id ---------- */
    parseFioBirth: function (raw) {
      var s = String(raw || '').replace(/\s+/g, ' ').trim();
      var birthRu = '';
      var m = s.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
      if (m) {
        birthRu = m[1] + '.' + m[2] + '.' + m[3];
        s = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
      }
      return { name: s, birthRu: birthRu };
    },

    /**
     * Политика patient_id:
     *  - точное совпадение ФИО + ДР → reuse старого id
     *  - иначе → null (демон выдаст новый)
     *  - одна фамилия без имени/ДР → всегда новый
     */
    patientIdPolicy: function () {
      return {
        requireMinTokens: 2,
        exactFioBirthReuse: true,
        singleSurnameNewId: true,
        emptyVisitAllowed: true          // пустые визиты при 10/2 всё равно пишутся
      };
    },

    canSaveWithoutRecs: function () { return true; },

    canCreateCalendar: function (fio) {
      return !!String(fio || '').trim();
    },

    /* ---------- рекомендации ---------- */
    recInsertMode: function (emptyBody) {
      // первая (пустое тело после «рек-но») → after_label; далее → at_cursor
      return emptyBody ? 'after_label' : 'at_cursor';
    },

    /* ---------- soft-delete ---------- */
    softDeleteMode: function () { return 'gcal_id_only'; },

    gcalMarker: function (eid) {
      return eid ? ('[LOR_GCAL_ID:' + eid + ']') : '';
    },

    isSoftDeleted: function (text) {
      return /\[УДАЛЕНО ИЗ GCAL/i.test(String(text || ''));
    },

    stripSoftDelete: function (text) {
      return String(text || '').replace(/\[УДАЛЕНО ИЗ GCAL[^\]]*\]\s*/gi, '').trim();
    },

    ensureGcalId: function (text, eid) {
      var t = String(text || '').trim();
      if (!eid) return t;
      if (t.indexOf('[LOR_GCAL_ID:') >= 0) return t;
      var marker = '[LOR_GCAL_ID:' + eid + ']';
      return t ? (t + '\n' + marker) : marker;
    },

    /* ---------- курс ---------- */
    /**
     * Курс ×10:
     *  - день 1 (сегодня): Базилик, обязательно оплата + названия процедур
     *  - дни 2–10: Павлин, только названия процедур (оплату не копировать)
     *  - пятницы пропускаются
     */
    coursePolicy: function () {
      return {
        totalDays: 10,
        skipWeekday: 5,                  // 5 = Friday
        day1Color: '10',                 // Базилик
        restColor: '7',                  // Павлин
        day1RequiresPayment: true,
        restProceduresOnly: true,        // на павлинах только процедуры, без суммы
        day1IncludesPaymentAndProcedures: true
      };
    },

    data_chain: function () { return this.dataChain(); },

    /* ---------- диагнозы (v1.2.1) ---------- */
    /**
     * Поля vc-dx1…5:
     *  — только ручной ввод или выбор из справочника;
     *  — автоподстановка из description/snap/буфера — только если строка
     *    похожа на диагноз (ICD или справочник), иначе отбрасывается;
     *  — рекомендации, процедуры, схемы лекарств в dx-поля НЕ попадают.
     */
    diagnosisPolicy: function () {
      return {
        source: 'manual_or_list',
        autoImport: 'icd_or_catalog_only',
        rejectFromRecs: true,
        maxLen: 180
      };
    },

    /** Мусор из recs/процедур — не диагноз */
    isJunkDiagnosisText: function (s) {
      s = String(s || '');
      if (!s.trim()) return false;
      return /процедур|медикаментоз|по окончании|список лекарств|рек-?но|промыван|анемизац|фонофор|тонзиллор|дни\s*\d|в нос |в горло|раз в день|международн|полидекса|неодекс|авамис|ципролет|аквалор|аква.?марис|назначен/i.test(s);
    },

    /**
     * @param {string} s
     * @param {string[]} [catalog] — LOR_VISIT_DATA.diagnoses
     */
    isValidDiagnosisText: function (s, catalog) {
      s = String(s || '').replace(/\s+/g, ' ').trim();
      if (!s) return false;
      if (s.length > 180) return false;
      if (this.isJunkDiagnosisText(s)) return false;
      if (/^[A-Z]\d{1,2}(?:\.\d{1,2})?/i.test(s)) return true;
      catalog = catalog || [];
      var low = s.toLowerCase();
      for (var i = 0; i < catalog.length; i++) {
        var d = String(catalog[i] || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!d) continue;
        if (low === d) return true;
        if (low.indexOf(d.slice(0, Math.min(24, d.length))) === 0) return true;
        if (d.indexOf(low.slice(0, Math.min(24, low.length))) === 0) return true;
      }
      return false;
    },

    /** Оставить только валидные диагнозы (до 5) */
    sanitizeDiagnosisList: function (arr, catalog) {
      var out = [];
      arr = Array.isArray(arr) ? arr : [];
      for (var i = 0; i < arr.length && out.length < 5; i++) {
        var s = String(arr[i] || '').trim();
        if (s && this.isValidDiagnosisText(s, catalog)) out.push(s);
      }
      while (out.length < 5) out.push('');
      return out;
    },

    /* ---------- совместимость со старыми именами (тесты / HTML) ---------- */
    is_db_color: function (c) { return this.isDbColor(c); },
    should_write_db: function (c) { return this.shouldWriteDb(c); },
    should_soft_delete: function (prev, next) { return this.shouldSoftDeleteOnColorChange(prev, next); },
    should_save_db_on_color: function (prev, next) { return this.shouldSaveDbOnColorChange(prev, next); },
    visit_duration: function () { return this.visitDurationMinutes(); },
    task_duration: function () { return this.taskDurationMinutes(); },
    is_service_summary: function (s) { return this.isServiceSummary(s); },
    parse_payment: function (text, any) { return this.parsePayment(text, { anyAmount: !!any }); },
    format_payment_line: function (m, a, s) { return this.formatPaymentLine(m, a, s); },
    payment_in_revenue: function (c) { return this.paymentCountsInRevenue(c); },
    parse_fio_birth: function (raw) { return this.parseFioBirth(raw); },
    can_save_without_recs: function () { return this.canSaveWithoutRecs(); },
    can_create_calendar: function (fio) { return this.canCreateCalendar(fio); },
    rec_insert_mode: function (empty) { return this.recInsertMode(empty); },
    soft_delete_mode: function () { return this.softDeleteMode(); },
    gcal_marker: function (eid) { return this.gcalMarker(eid); },
    is_soft_deleted: function (t) { return this.isSoftDeleted(t); },
    strip_soft_delete: function (t) { return this.stripSoftDelete(t); },
    ensure_gcal_id: function (t, e) { return this.ensureGcalId(t, e); },
    print_policy: function () { return this.printPolicy(); },
    is_valid_diagnosis: function (s, c) { return this.isValidDiagnosisText(s, c); },
    sanitize_diagnosis_list: function (a, c) { return this.sanitizeDiagnosisList(a, c); },
    save_targets: function (c) { return this.saveTargets(c); }
  };

  // Node / browser
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LOR_RULES;
  }
  if (typeof root !== 'undefined') {
    root.LOR_RULES = LOR_RULES;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
