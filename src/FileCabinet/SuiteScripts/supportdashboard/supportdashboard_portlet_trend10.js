/**
 * @NApiVersion 2.1
 * @NScriptType Portlet
 *
 * Supportdashboard – kompakt Trend-portlet (senaste 10 dagarna)
 * ===============================================================
 * Speglar sektion 4 (Inflöde mot utflöde) i huvuddashboarden, men med
 * DAGSgranularitet över bara de senaste 10 dagarna i stället för
 * huvuddashboardens månadsvisa 12/24-månadersvy – tänkt som en snabb
 * "vad hände nyligen"-glimt på NetSuite-dashboarden, inte en ersättning
 * för den fullständiga trenden.
 *
 * Samma fem flöden som sektion 4, med samma definitioner (se
 * supportdashboard_suitelet.js och dashboard_mall.html, funktionen trend()):
 *  - Inkomna         = sc.datecreated föll på dagen
 *  - Nådde In Progress / Solution proposal / Solved = respektive
 *    milstolpsdatum (custevent_nic_na_case_sla_ms1/ms2/ms3_date) föll på
 *    dagen – oavsett ärendets status idag.
 *  - Stängda (Closed) = sc.enddate föll på dagen (sätts bara vid faktisk
 *    stängning, inte vid Solved).
 * Räknas över HELA ärendestocken (inte bara öppen backlog), precis som
 * sektion 4 – ett ärende som skapades eller stängdes för mer än 10 dagar
 * sedan bidrar ändå inte till en tidigare dag, det faller bara utanför
 * fönstret helt.
 *
 * Klick på knappen öppnar INTE denna 10-dagarsvy, utan hela sektion 4
 * (12/24-månadersvyn, med samma fyra filter som huvuddashboardens header)
 * som en fokusvy i ett eget fönster – #vy=trend (URL-FRAGMENT, inte en
 * vanlig query-parameter – se motiveringen i dashboard_mall.html/README:
 * fragment skickas aldrig till servern, vilket krävs för att undvika att
 * NetSuites/Akamais infrastruktur serverar en inaktuell cachad sida för en
 * viss query-sträng även efter "Uppdatera dashboard").
 *
 * Byggd utan inline <script> i portlet-HTML:en (till skillnad från
 * huvuddashboardens interaktiva SVG-diagram): flera Custom Portlets kan
 * ligga på samma NetSuite-dashboardsida samtidigt, och delade globala
 * JS-namn mellan dem skulle kunna krocka. Diagrammet här är därför en helt
 * statisk SVG, förberäknad på servern, utan hover/tooltips.
 *
 * Samma testärende-filter och 15-minuters cache-princip som övriga
 * portletar i detta projekt.
 */
define(['N/query', 'N/cache', 'N/url', 'N/log'],
function (query, cache, url, log) {

    var TESTMONSTER = /\btest/i;
    var CACHE_NAME = 'supportdashboard';
    var CACHE_KEY = 'portlet_trend10_v1';
    var CACHE_TTL_SEK = 900; // 15 minuter

    var DASHBOARD_SCRIPT_ID = 'customscript_supportdashboard';
    var DASHBOARD_DEPLOY_ID = 'customdeploy_supportdashboard';

    // Samma färger som --s1..--s5 i dashboard_mall.html (ljust läge), i
    // samma ordning som linjerna ritas i trend(): in, ms1, ms2, ms3, ut.
    var FARG = { in_: '#2a78d6', ms1: '#eda100', ms2: '#e87ba4', ms3: '#1f9e57', ut: '#eb6834' };

    // =======================================================================
    // Entry point
    // =======================================================================
    function render(params) {
        var portlet = params.portlet;
        portlet.title = 'Supportdashboard – Trend (10 dagar)';
        try {
            var data = hamtaData();
            portlet.html = byggHtml(data);
        } catch (e) {
            log.error({ title: 'supportdashboard_portlet_trend10: fel', details: (e && e.message) || e });
            portlet.html =
                '<div style="font:13px system-ui,sans-serif;color:#9a3b3b;padding:6px 2px">' +
                'Kunde inte hämta trenddata just nu. Se Execution Log för detaljer.</div>';
        }
    }

    // =======================================================================
    // Data
    // =======================================================================
    function hamtaData() {
        var c = cache.getCache({ name: CACHE_NAME, scope: cache.Scope.PROTECTED });
        var json = c.get({ key: CACHE_KEY, loader: beraknaJson, ttl: CACHE_TTL_SEK });
        return JSON.parse(json);
    }

    function beraknaJson() {
        var idag = hamtaIdag();
        var idagDagar = datumTillDagar(idag);

        // De tio senaste kalenderdagarna, äldst först, idag sist.
        var dagar = [];
        for (var i = 9; i >= 0; i--) dagar.push(dagFranDagnummer(idagDagar - i));

        var arenden = hamtaArenden();
        var riktiga = arenden.filter(function (r) { return !TESTMONSTER.test(r.title || ''); });

        var inC = {}, utC = {}, ms1C = {}, ms2C = {}, ms3C = {};
        dagar.forEach(function (d) { inC[d] = 0; utC[d] = 0; ms1C[d] = 0; ms2C[d] = 0; ms3C[d] = 0; });

        riktiga.forEach(function (r) {
            if (r.datecreated != null && inC.hasOwnProperty(r.datecreated)) inC[r.datecreated]++;
            if (r.enddate != null && utC.hasOwnProperty(r.enddate)) utC[r.enddate]++;
            if (r.ms1 != null && ms1C.hasOwnProperty(r.ms1)) ms1C[r.ms1]++;
            if (r.ms2 != null && ms2C.hasOwnProperty(r.ms2)) ms2C[r.ms2]++;
            if (r.ms3 != null && ms3C.hasOwnProperty(r.ms3)) ms3C[r.ms3]++;
        });

        var rows = dagar.map(function (d) {
            return { dag: d, in_: inC[d], ut: utC[d], ms1: ms1C[d], ms2: ms2C[d], ms3: ms3C[d] };
        });
        var net = rows.reduce(function (a, r) { return a + r.in_ - r.ut; }, 0);
        var summa = { in_: 0, ut: 0, ms1: 0, ms2: 0, ms3: 0 };
        rows.forEach(function (r) {
            summa.in_ += r.in_; summa.ut += r.ut; summa.ms1 += r.ms1; summa.ms2 += r.ms2; summa.ms3 += r.ms3;
        });

        return JSON.stringify({ rows: rows, net: net, summa: summa, idag: idag });
    }

    function hamtaArenden() {
        var sql =
            "SELECT sc.id, sc.title, " +
            "TO_CHAR(sc.datecreated, 'YYYY-MM-DD') AS datecreated, " +
            "TO_CHAR(sc.enddate, 'YYYY-MM-DD') AS enddate, " +
            "TO_CHAR(sc.custevent_nic_na_case_sla_ms1_date, 'YYYY-MM-DD') AS ms1, " +
            "TO_CHAR(sc.custevent_nic_na_case_sla_ms2_date, 'YYYY-MM-DD') AS ms2, " +
            "TO_CHAR(sc.custevent_nic_na_case_sla_ms3_date, 'YYYY-MM-DD') AS ms3 " +
            "FROM supportcase sc ORDER BY sc.id";
        var rader = [];
        var sidor = query.runSuiteQLPaged({ query: sql, pageSize: 1000 });
        for (var i = 0; i < sidor.pageRanges.length; i++) {
            rader = rader.concat(sidor.fetch({ index: i }).data.asMappedResults());
        }
        return rader;
    }

    function hamtaIdag() {
        var row = query.runSuiteQL({
            query: "SELECT TO_CHAR(SYSDATE, 'YYYY-MM-DD') AS datum FROM DUAL"
        }).asMappedResults()[0];
        return row.datum;
    }

    function datumTillDagar(dstr) {
        var d = new Date(dstr + 'T00:00:00Z');
        return Math.floor(d.getTime() / 86400000);
    }

    function dagFranDagnummer(dagar) {
        return new Date(dagar * 86400000).toISOString().slice(0, 10);
    }

    // =======================================================================
    // Rendering – helt statisk SVG (inget inline <script>, se filhuvudet).
    // =======================================================================
    function dashboardUrl(hash) {
        try {
            var bas = url.resolveScript({
                scriptId: DASHBOARD_SCRIPT_ID,
                deploymentId: DASHBOARD_DEPLOY_ID,
                returnExternalUrl: false
            });
            return hash ? (bas + '#' + hash) : bas;
        } catch (e) {
            return '#';
        }
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function byggSvg(rows) {
        var W = 280, H = 84, padL = 4, padR = 4, padT = 6, padB = 14;
        var max = Math.max(2, rows.reduce(function (m, r) {
            return Math.max(m, r.in_, r.ut, r.ms1, r.ms2, r.ms3);
        }, 0));
        var n = rows.length;
        var x = function (i) { return padL + (W - padL - padR) * (n < 2 ? 0.5 : i / (n - 1)); };
        var y = function (v) { return padT + (H - padT - padB) * (1 - v / max); };
        var linje = function (key, farg) {
            var d = rows.map(function (r, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(r[key]).toFixed(1); }).join(' ');
            return '<path d="' + d + '" fill="none" stroke="' + farg + '" stroke-width="2" ' +
                'stroke-linejoin="round" stroke-linecap="round"/>';
        };
        var baslinje = '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (H - padB) + '" y2="' + (H - padB) + '" ' +
            'stroke="#d8d7d0" stroke-width="1"/>';
        var etiketter = rows.map(function (r, i) {
            return '<text x="' + x(i).toFixed(1) + '" y="' + (H - 2) + '" text-anchor="middle" ' +
                'font-size="9" fill="#898781">' + escapeHtml(r.dag.slice(8, 10)) + '</text>';
        }).join('');
        return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">' +
            baslinje +
            linje('in_', FARG.in_) + linje('ms1', FARG.ms1) + linje('ms2', FARG.ms2) +
            linje('ms3', FARG.ms3) + linje('ut', FARG.ut) +
            etiketter +
            '</svg>';
    }

    function legendRad(farg, etikett, summa) {
        return '<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;white-space:nowrap">' +
            '<span style="width:10px;height:3px;border-radius:2px;background:' + farg + ';display:inline-block"></span>' +
            escapeHtml(etikett) + ' <b>' + summa + '</b></span>';
    }

    function byggHtml(d) {
        var nettoTecken = d.net > 0 ? '+' : '';
        var nettoFarg = d.net > 0 ? '#eb6834' : '#008300';
        return '' +
            '<div style="font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,sans-serif;padding:4px 2px 2px">' +
            byggSvg(d.rows) +
            '<div style="font-size:11px;color:#52514e;margin:6px 0 8px;line-height:1.7">' +
            legendRad(FARG.in_, 'Inkomna', d.summa.in_) +
            legendRad(FARG.ms1, 'In Progress', d.summa.ms1) +
            legendRad(FARG.ms2, 'Sol.förslag', d.summa.ms2) +
            legendRad(FARG.ms3, 'Solved', d.summa.ms3) +
            legendRad(FARG.ut, 'Stängda', d.summa.ut) +
            '</div>' +
            '<div style="font-size:11px;color:#6b6b66;margin-bottom:8px">' +
            'Netto senaste 10 dagarna: <b style="color:' + nettoFarg + '">' + nettoTecken + d.net + '</b> ärenden ' +
            '(cache, max 15 min gammal, t.o.m. ' + escapeHtml(d.idag) + ')</div>' +
            '<a href="' + dashboardUrl('vy=trend') + '" target="_blank" rel="noopener" style="display:inline-block;font-size:12px;' +
            'padding:6px 14px;border-radius:6px;background:#2a78d6;color:#fff;text-decoration:none">' +
            'Öppna Inflöde/utflöde i eget fönster &rarr;</a>' +
            '</div>';
    }

    return { render: render };
});
