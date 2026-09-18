/**
 * @NApiVersion 2.1
 * @NScriptType Portlet
 *
 * Supportdashboard – kompakt KPI-portlet
 * =======================================
 * Visar fyra nyckeltal (öppen backlog, ärenden utan första svar, ärenden
 * tysta i över 30 dagar, netto senaste 30 dagarna) direkt på NetSuite-
 * dashboarden, plus en länk vidare till den fullständiga Suiteleten
 * (customscript_supportdashboard).
 *
 * Byggd MEDVETET lättare än huvud-Suiteleten:
 *  - Hämtar bara de kolumner som krävs för just dessa fyra tal (inget
 *    namn-/nyckelordsuppslag, ingen HTML-rendering av hela dashboarden).
 *  - Samma testärende-filter (/\btest/i på titeln, ordgränsbundet) och
 *    samma definition av "öppen backlog" (status ∉ {Closed, Solved}) som
 *    huvudscriptet – se STANGDA/TESTMONSTER i supportdashboard_suitelet.js.
 *    Ändras en av dessa definitioner på ett ställe, ändra på båda.
 *  - Resultatet cachas (N/cache, 15 minuter) eftersom en portlet räknas om
 *    varje gång NÅGON öppnar sin dashboard – utan cache skulle samma
 *    SuiteQL-fråga över hela ärendestocken köras om och om igen inom loppet
 *    av en vanlig arbetsdag. Vill du se en färsk siffra direkt, öppna den
 *    fullständiga dashboarden (länken) och klicka "Uppdatera dashboard" –
 *    portlet-cachen självläker efter 15 minuter oavsett.
 *
 * Driftsättning: samma sätt som Suiteleten (SDF-projektet), se README.md.
 * Efter deploy: Personalize Dashboard → Custom Portlet → Set Up → välj
 * detta script som källa. Portlet-deploymentets Audience/roller sätts
 * manuellt i NetSuite-gränssnittet, se README.
 */
define(['N/query', 'N/cache', 'N/url', 'N/log'],
function (query, cache, url, log) {

    // Samma definitioner som i supportdashboard_suitelet.js – hålls i synk
    // manuellt, se filhuvudet ovan.
    var STANGDA = [5, 9];        // Closed, Solved – räknas inte som öppen backlog
    var TESTMONSTER = /\btest/i; // ordgränsbundet, samma som huvudscriptet/Python

    var CACHE_NAME = 'supportdashboard';
    var CACHE_KEY = 'portlet_kpi_v1';
    var CACHE_TTL_SEK = 900; // 15 minuter

    var DASHBOARD_SCRIPT_ID = 'customscript_supportdashboard';
    var DASHBOARD_DEPLOY_ID = 'customdeploy_supportdashboard';

    // =======================================================================
    // Entry point
    // =======================================================================
    function render(params) {
        var portlet = params.portlet;
        portlet.title = 'Supportdashboard';
        try {
            var kpi = hamtaKpi();
            portlet.html = byggHtml(kpi);
        } catch (e) {
            log.error({ title: 'supportdashboard_portlet: fel', details: (e && e.message) || e });
            portlet.html =
                '<div style="font:13px system-ui,sans-serif;color:#9a3b3b;padding:6px 2px">' +
                'Kunde inte hämta supportdata just nu. Se Execution Log för detaljer.</div>';
        }
    }

    // =======================================================================
    // Data – lätt SuiteQL-fråga + cache
    // =======================================================================
    function hamtaKpi() {
        var c = cache.getCache({ name: CACHE_NAME, scope: cache.Scope.PROTECTED });
        var json = c.get({ key: CACHE_KEY, loader: beraknaKpiJson, ttl: CACHE_TTL_SEK });
        return JSON.parse(json);
    }

    function beraknaKpiJson() {
        var idag = hamtaIdag();
        var idagDagar = datumTillDagar(idag);

        var sql =
            "SELECT sc.id, sc.title, sc.status, " +
            "TO_CHAR(sc.datecreated, 'YYYY-MM-DD') AS datecreated, " +
            "TO_CHAR(sc.enddate, 'YYYY-MM-DD') AS enddate, " +
            "TO_CHAR(sc.supportfirstreply, 'YYYY-MM-DD') AS supportfirstreply, " +
            "TO_CHAR(sc.lastmessagedate, 'YYYY-MM-DD') AS lastmessagedate " +
            "FROM supportcase sc ORDER BY sc.id";
        var rader = [];
        var sidor = query.runSuiteQLPaged({ query: sql, pageSize: 1000 });
        for (var i = 0; i < sidor.pageRanges.length; i++) {
            rader = rader.concat(sidor.fetch({ index: i }).data.asMappedResults());
        }
        var riktiga = rader.filter(function (r) { return !TESTMONSTER.test(r.title || ''); });

        function sedan(nDagar) { return idagDagar - nDagar; }

        var backlog = 0, utanForstasvar = 0, tysta30 = 0, nya30 = 0, stangda30 = 0, aldstaDagar = 0;

        riktiga.forEach(function (r) {
            var statusid = Number(r.status);
            var oppen = STANGDA.indexOf(statusid) === -1;
            var skapadDagar = r.datecreated ? datumTillDagar(r.datecreated) : null;

            if (oppen) {
                backlog++;
                if (!r.supportfirstreply) utanForstasvar++;
                if (r.lastmessagedate) {
                    var tystDagar = idagDagar - datumTillDagar(r.lastmessagedate);
                    if (tystDagar > 30) tysta30++;
                }
                if (skapadDagar != null) {
                    aldstaDagar = Math.max(aldstaDagar, idagDagar - skapadDagar);
                }
            }
            if (skapadDagar != null && skapadDagar > sedan(30)) nya30++;
            if (r.enddate && datumTillDagar(r.enddate) > sedan(30)) stangda30++;
        });

        return JSON.stringify({
            backlog: backlog,
            utan_forstasvar: utanForstasvar,
            tysta30: tysta30,
            netto30: nya30 - stangda30,
            aldsta_dagar: aldstaDagar,
            uppdaterad: idag
        });
    }

    function hamtaIdag() {
        var row = query.runSuiteQL({
            query: "SELECT TO_CHAR(SYSDATE, 'YYYY-MM-DD') AS datum FROM DUAL"
        }).asMappedResults()[0];
        return row.datum;
    }

    function datumTillDagar(dstr) {
        // 'YYYY-MM-DD' -> dagar sedan epok, UTC-baserat. Samma metod (bara
        // heltalsdagar, ingen tidszonskänslighet) som i huvud-Suiteleten.
        var d = new Date(dstr + 'T00:00:00Z');
        return Math.floor(d.getTime() / 86400000);
    }

    // =======================================================================
    // Rendering – ren HTML/inline-CSS, ingen extern CSS/JS (Inline HTML-
    // portletar bör vara helt självbärande).
    // =======================================================================
    function dashboardUrl() {
        try {
            return url.resolveScript({
                scriptId: DASHBOARD_SCRIPT_ID,
                deploymentId: DASHBOARD_DEPLOY_ID,
                returnExternalUrl: false
            });
        } catch (e) {
            return '#';
        }
    }

    function tile(etikett, varde, farg) {
        return '' +
            '<div style="border:1px solid #e3e3e0;border-radius:8px;padding:8px 10px;min-width:0">' +
            '<div style="font-size:11px;color:#6b6b66;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
            escapeHtml(etikett) + '</div>' +
            '<div style="font-size:22px;font-weight:600;line-height:1.3;' +
            (farg ? 'color:' + farg + ';' : '') + '">' + escapeHtml(String(varde)) + '</div>' +
            '</div>';
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function byggHtml(kpi) {
        var nettoTecken = kpi.netto30 > 0 ? '+' : '';
        var nettoFarg = kpi.netto30 > 0 ? '#eb6834' : '#008300';
        return '' +
            '<div style="font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,sans-serif;padding:4px 2px 2px">' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">' +
            tile('Öppen backlog', kpi.backlog, null) +
            tile('Utan första svar', kpi.utan_forstasvar, kpi.utan_forstasvar > 0 ? '#e34948' : null) +
            tile('Tysta > 30 dagar', kpi.tysta30, kpi.tysta30 > 0 ? '#eb6834' : null) +
            tile('Netto 30 dagar', nettoTecken + kpi.netto30, nettoFarg) +
            '</div>' +
            '<div style="font-size:11px;color:#6b6b66;margin-bottom:8px">' +
            'Uppdaterad ' + escapeHtml(kpi.uppdaterad) + ' (cache, max 15 min gammal) &middot; ' +
            'äldsta öppna ärendet ' + kpi.aldsta_dagar + ' dagar</div>' +
            '<a href="' + dashboardUrl() + '" style="display:inline-block;font-size:12px;' +
            'padding:6px 14px;border-radius:6px;background:#2a78d6;color:#fff;text-decoration:none">' +
            'Öppna full dashboard &rarr;</a>' +
            '</div>';
    }

    return { render: render };
});
