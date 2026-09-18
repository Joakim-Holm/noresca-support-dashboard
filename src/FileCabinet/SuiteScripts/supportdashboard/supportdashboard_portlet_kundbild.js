/**
 * @NApiVersion 2.1
 * @NScriptType Portlet
 *
 * Supportdashboard – kompakt Kundbild-portlet
 * =============================================
 * Bryter ut det viktigaste ur sektion 6 (Kundbild) från huvuddashboarden:
 * de fem kunder som har flest ÖPPNA ärenden just nu – var backloggen är
 * koncentrerad. Avtalsnivå (SLA) visas per kund, med "No SLA" markerad,
 * eftersom det både är ett avtalsfaktum och ett skäl att inga svarstider
 * mäts för den kunden (se references/matt-och-avvikelser.md, fältkvalitet).
 *
 * Öppen backlog = status ∉ {Closed, Solved}, samma definition som övriga
 * script i det här projektet (STANGDA i supportdashboard_suitelet.js).
 *
 * Kund-/SLA-namn hämtas från samma namn.json i File Cabinet som Suiteleten
 * använder (se den filens huvud) – INTE via en egen entity-uppslagning, för
 * att hålla portleten billig. En ny kund som ännu inte lagts till i
 * namn.json visas som "Kund #<id>" tills filen uppdateras.
 *
 * Samma testärende-filter och 15-minuters cache-princip som de andra
 * portletarna i detta projekt.
 *
 * Klick på "Öppna Kundbild"-knappen tar dig INTE till hela dashboarden,
 * utan till en fokusvy av just sektion 6 (samma Suitelet, men öppnad med
 * #vy=kundbild) – en egen flik/fönster med samma fyra filter (Kund, Avtal,
 * Typ, Arbetsart) som huvuddashboardens header. Se dashboard_mall.html,
 * avsnittet "fokusvy", för hur URL-fragmentet tolkas klientsidan.
 *
 * OBS: vy-värdet skickas som URL-FRAGMENT (#vy=kundbild), inte som vanlig
 * query-parameter (?vy=kundbild) som en tidigare version gjorde – ett
 * fragment skickas aldrig till servern, vilket visade sig krävas för att
 * undvika att NetSuites/Akamais infrastruktur serverade en inaktuell cachad
 * sida för just den query-strängen (även efter "Uppdatera dashboard").
 */
define(['N/query', 'N/file', 'N/cache', 'N/url', 'N/log'],
function (query, file, cache, url, log) {

    var STANGDA = [5, 9]; // Closed, Solved
    var TESTMONSTER = /\btest/i;
    var CACHE_NAME = 'supportdashboard';
    var CACHE_KEY = 'portlet_kundbild_v1';
    var CACHE_TTL_SEK = 900; // 15 minuter

    var MAPP = 'SuiteScripts/supportdashboard/';
    var NAMN_PATH = MAPP + 'namn.json';

    var DASHBOARD_SCRIPT_ID = 'customscript_supportdashboard';
    var DASHBOARD_DEPLOY_ID = 'customdeploy_supportdashboard';

    // =======================================================================
    // Entry point
    // =======================================================================
    function render(params) {
        var portlet = params.portlet;
        portlet.title = 'Supportdashboard – Kundbild';
        try {
            var data = hamtaData();
            portlet.html = byggHtml(data);
        } catch (e) {
            log.error({ title: 'supportdashboard_portlet_kundbild: fel', details: (e && e.message) || e });
            portlet.html =
                '<div style="font:13px system-ui,sans-serif;color:#9a3b3b;padding:6px 2px">' +
                'Kunde inte hämta kunddata just nu. Se Execution Log för detaljer.</div>';
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
        var namn = hamtaNamn();
        var kunderMap = namn.kunder || {};
        var slaMap = namn.sla || {};

        var arenden = hamtaArenden();
        var riktiga = arenden.filter(function (r) { return !TESTMONSTER.test(r.title || ''); });
        var oppna = riktiga.filter(function (r) { return STANGDA.indexOf(Number(r.status)) === -1; });

        var raknare = {}; // kund-id -> antal öppna
        oppna.forEach(function (r) {
            var kid = (r.company !== null && r.company !== undefined) ? Number(r.company) : null;
            if (kid == null) return;
            raknare[kid] = (raknare[kid] || 0) + 1;
        });

        var topp = Object.keys(raknare)
            .map(function (kid) {
                return {
                    id: kid,
                    namn: kunderMap[String(kid)] || ('Kund #' + kid),
                    sla: slaMap[String(kid)] || 'Ej verifierad',
                    oppna: raknare[kid]
                };
            })
            .sort(function (a, b) { return b.oppna - a.oppna || a.namn.localeCompare(b.namn, 'sv'); })
            .slice(0, 5);

        return JSON.stringify({ topp: topp, backlog: oppna.length });
    }

    function hamtaArenden() {
        var sql =
            "SELECT sc.id, sc.title, sc.status, sc.company FROM supportcase sc ORDER BY sc.id";
        var rader = [];
        var sidor = query.runSuiteQLPaged({ query: sql, pageSize: 1000 });
        for (var i = 0; i < sidor.pageRanges.length; i++) {
            rader = rader.concat(sidor.fetch({ index: i }).data.asMappedResults());
        }
        return rader;
    }

    function hamtaNamn() {
        try {
            return JSON.parse(file.load({ id: NAMN_PATH }).getContents());
        } catch (e) {
            log.error({ title: 'supportdashboard_portlet_kundbild: kunde inte läsa namn.json', details: (e && e.message) || e });
            return {};
        }
    }

    // =======================================================================
    // Rendering
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

    function rad(k, max) {
        var breddPct = Math.max(6, Math.round(100 * k.oppna / max));
        var slaTagg = k.sla === 'No SLA'
            ? '<span style="font-size:10px;color:#9a3b3b;border:1px solid #e0b4b4;border-radius:4px;padding:0 4px;margin-left:6px">No SLA</span>'
            : '';
        return '' +
            '<div style="margin-bottom:7px">' +
            '<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;margin-bottom:2px">' +
            '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(k.namn) + slaTagg + '</span>' +
            '<span style="font-weight:600;white-space:nowrap">' + k.oppna + '</span>' +
            '</div>' +
            '<div style="background:#eee;border-radius:3px;height:5px;overflow:hidden">' +
            '<div style="background:#2a78d6;height:5px;width:' + breddPct + '%"></div></div>' +
            '</div>';
    }

    function byggHtml(d) {
        var max = Math.max(1, d.topp.reduce(function (m, k) { return Math.max(m, k.oppna); }, 0));
        var rader = d.topp.map(function (k) { return rad(k, max); }).join('');
        return '' +
            '<div style="font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,sans-serif;padding:4px 2px 2px">' +
            '<div style="font-size:11px;color:#6b6b66;margin-bottom:8px">' +
            'Flest öppna ärenden just nu, av ' + d.backlog + ' i hela backloggen</div>' +
            (rader || '<div style="color:#999;font-size:12px">Ingen öppen backlog</div>') +
            '<a href="' + dashboardUrl('vy=kundbild') + '" target="_blank" rel="noopener" style="display:inline-block;font-size:12px;margin-top:4px;' +
            'padding:6px 14px;border-radius:6px;background:#2a78d6;color:#fff;text-decoration:none">' +
            'Öppna Kundbild i eget fönster &rarr;</a>' +
            '</div>';
    }

    return { render: render };
});
