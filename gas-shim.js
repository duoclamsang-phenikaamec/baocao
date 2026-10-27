/**
 * gas-shim.js — giả lập google.script.run bằng fetch tới API Apps Script.
 * Nhờ file này, toàn bộ code giao diện cũ (Index.html, TuTrucForm.html)
 * chạy trên GitHub Pages mà KHÔNG phải sửa dòng google.script.run nào.
 *
 * Tăng tốc:
 *  - Danh mục + gợi ý được nhớ trong trình duyệt -> lần mở sau hiện ngay,
 *    rồi tự cập nhật ngầm cho lần sau.
 *  - Danh mục, gợi ý thuốc, gợi ý NVYT được gọi SONG SONG ngay khi trang mở
 *    (code cũ phải đợi danh mục xong mới gọi gợi ý).
 *  Nạp file này TRƯỚC script chính, ngay trong <head>.
 */
(function () {
  var CFG = window.APP_CONFIG || {};
  var KEY_STORE = 'dls_api_key';
  var CACHE_PREFIX = 'dls_cache_v1:';
  var CACHE_TUOI_TOI_DA = 24 * 3600 * 1000;      // quá 24h thì đợi mạng, không dùng bản cũ

  // Hàm được nhớ phía trình duyệt
  var CO_CACHE = { getDanhMuc: 1, tt_layDanhMuc: 1, getGoiYThuoc: 1, getGoiYNVYT: 1, getChuyenKhoa: 1 };
  // Lưu xong thì bỏ bản nhớ của gợi ý liên quan
  var XOA_SAU = { luuCanThiep: ['getGoiYThuoc', 'getGoiYNVYT'] };
  // Gọi trước ngay khi trang mở
  var GOI_TRUOC = ['getDanhMuc', 'getGoiYThuoc', 'getGoiYNVYT'];

  var dangChay = {};   // khoá -> Promise đang chạy (gộp các lần gọi trùng)

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // Không hỏi mã trước. Chỉ khi máy chủ có đặt mã (UNAUTHORIZED) mới hỏi 1 lần rồi nhớ.
  function layMa() { return lsGet(KEY_STORE) || ''; }

  function goiApi(fn, args, thuLai) {
    var t0 = Date.now();
    return fetch(CFG.API_URL, {
      method: 'POST',
      // text/plain để trình duyệt KHÔNG gửi preflight CORS (Apps Script không trả lời preflight)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args || [], key: layMa() }),
      redirect: 'follow'
    }).then(function (r) {
      if (!r.ok) throw new Error('Lỗi mạng HTTP ' + r.status);
      return r.text();
    }).then(function (txt) {
      var res;
      try { res = JSON.parse(txt); }
      catch (e) { throw new Error('API không trả JSON — kiểm tra deploy đặt "Anyone" và link /exec đúng.'); }
      if (res.error === 'UNAUTHORIZED') {
        lsDel(KEY_STORE);
        if (!thuLai) {
          var k = (window.prompt('Ứng dụng yêu cầu mã truy cập:') || '').trim();
          if (k) { lsSet(KEY_STORE, k); return goiApi(fn, args, true); }
        }
        throw new Error('Sai mã truy cập. Tải lại trang và nhập lại mã.');
      }
      if (!res.ok) throw new Error(res.error || 'Lỗi máy chủ');
      if (window.console) console.log('[API] ' + fn + ' ' + (Date.now() - t0) + 'ms (server ' + res.ms + 'ms)');
      return res.data;
    });
  }

  function khoa(fn, args) { return fn + ':' + JSON.stringify(args || []); }

  function goiMang(fn, args) {
    var k = khoa(fn, args);
    if (dangChay[k]) return dangChay[k];
    var p = goiApi(fn, args).then(function (data) {
      if (CO_CACHE[fn]) lsSet(CACHE_PREFIX + k, JSON.stringify({ t: Date.now(), d: data }));
      delete dangChay[k];
      return data;
    }, function (e) { delete dangChay[k]; throw e; });
    dangChay[k] = p;
    return p;
  }

  function chay(fn, args) {
    if (CO_CACHE[fn]) {
      var raw = lsGet(CACHE_PREFIX + khoa(fn, args));
      if (raw) {
        try {
          var c = JSON.parse(raw);
          if (Date.now() - c.t < CACHE_TUOI_TOI_DA) {
            goiMang(fn, args).catch(function () {});   // cập nhật ngầm cho lần sau
            return Promise.resolve(c.d);
          }
        } catch (e) {}
      }
      return goiMang(fn, args);
    }
    return goiApi(fn, args).then(function (data) {
      (XOA_SAU[fn] || []).forEach(function (f) { lsDel(CACHE_PREFIX + khoa(f, [])); });
      return data;
    });
  }

  // google.script.run.withSuccessHandler(f).withFailureHandler(g).tenHam(...)
  function taoRunner(ok, loi) {
    return new Proxy({}, {
      get: function (_, ten) {
        if (ten === 'withSuccessHandler') return function (f) { return taoRunner(f, loi); };
        if (ten === 'withFailureHandler') return function (f) { return taoRunner(ok, f); };
        if (ten === 'withUserObject') return function () { return taoRunner(ok, loi); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          chay(String(ten), args).then(
            function (d) { if (ok) ok(d); },
            function (e) { if (loi) loi(e); else if (window.console) console.error(e); }
          );
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = taoRunner(null, null);

  // Xoá mã + bộ nhớ đệm (gõ dlsDangXuat() trong Console nếu cần)
  window.dlsDangXuat = function () {
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k === KEY_STORE || k.indexOf(CACHE_PREFIX) === 0) localStorage.removeItem(k);
      });
    } catch (e) {}
    location.reload();
  };

  // Gọi trước song song ngay khi trang mở (chỉ khi chưa có bản nhớ còn mới)
  GOI_TRUOC.forEach(function (fn) {
    var raw = lsGet(CACHE_PREFIX + khoa(fn, []));
    var conMoi = false;
    try { conMoi = raw && (Date.now() - JSON.parse(raw).t < CACHE_TUOI_TOI_DA); } catch (e) {}
    if (!conMoi) goiMang(fn, []).catch(function () {});
  });
})();
