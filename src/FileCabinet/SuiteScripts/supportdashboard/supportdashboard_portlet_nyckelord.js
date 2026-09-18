/**
 * @NApiVersion 2.1
 * @NScriptType Portlet
 *
 * Supportdashboard – kompakt Nyckelord-portlet
 * =============================================
 * Bryter ut sektion 5 (Nyckelord) från huvuddashboarden till en egen,
 * kompakt vy på NetSuite-dashboarden: topp-3 i alla tre nedbrytningarna
 * (ämnesområden, enskilda nyckelord, kategorier) i stället för topp-5 i en
 * av dem – för att alla tre ska få plats i en portlet-ruta.
 *
 * Räknas över HELA ärendestocken (inte bara öppen backlog) – samma scope
 * som sektion 5 i huvuddashboarden. Samma tre klassificeringsregler som
 * dashboard_mall.html:
 *  - "Ämnesområden" grupperar på nyckelordets ÖVERORDNADE nyckelord
 *    (custrecord_nic_na_key_parent), med self-parent-regeln: ett nyckelord
 *    utan eget överordnat nyckelord bildar sin egen grupp (kwParent()).
 *  - "Enskilda nyckelord" räknar varje nyckelord för sig, utan gruppering.
 *  - "Kategorier" grupperar på nyckelordets EGEN kategori
 *    (custrecord_nic_na_key_cat) – ett annat fält än ämnesområdet, se
 *    caveat i references/matt-och-avvikelser.md om namnlikheten.
 * Se dashboard_mall.html (kwParent/grupperaNyckelord/grupperaKategori/
 * topparNyckelord) för originalimplementationen denna portlet speglar.
 *
 * Samma testärende-filter (/\btest/i på titeln) som övriga script i det
 * här projektet, och samma 15-minuters cache-princip som
 * supportdashboard_portlet.js (KPI-portleten) – se den filens huvud för
 * motiveringen.
 */
define(['N/query', 'N/cache', 'N/url', 'N/log'],
function (query, cache, url, log) {

    var TESTMONSTER = /\btest/i;
    var CACHE_NAME = 'supportdashboard';
    var CACHE_KEY = 'portlet_nyckelord_v1';
    var CACHE_TTL_SEK = 900; // 15 minuter

    var DASHBOARD_SCRIPT_ID = 'customscript_supportdashboard';
    var DASHBOARD_DEPLOY_ID = 'customdeploy_supportdashboard';

    // =======================================================================
    // Entry point
    // =======================================================================
    function render(params) {
        var portlet = params.portlet;
        portlet.title = 'Supportdashboard – Nyckelord';
        try {
            var data = hamtaData();
            portlet.html = byggHtml(data);
        } catch (e) {
            log.error({ title: 'supportdashboard_portlet_nyckelord: fel', details: (e && e.message) || e });
            portlet.html =
                '<div style="font:13px system-ui,sans-serif;color:#9a3b3b;padding:6px 2px">' +
                'Kunde inte hämta nyckelordsdata just nu. Se Execution Log för detaljer.</div>';
        }
    }

    // =======================================================================
    // Data – lätt SuiteQL-fråga (bara id/titel/nyckelord-fält) + cache
    // =======================================================================
    function hamtaData() {
        var c = cache.getCache({ name: CACHE_NAME, scope: cache.Scope.PROTECTED });
        var json = c.get({ key: CACHE_KEY, loader: beraknaJson, ttl: CACHE_TTL_SEK });
        return JSON.parse(json);
    }

    function beraknaJson() {
        var nyckelord = hamtaNyckelord();
        var arenden = hamtaArenden();
        var riktiga = arenden.filter(function (r) { return !TESTMONSTER.test(r.title || ''); });

        var harKw = 0;
        var raknareAmne = {};   // parent-id -> antal ärenden (dedup per ärende)
        var raknareEnskild = {}; // kw-id -> antal ärenden
        var raknareKat = {};    // kategori-id -> antal ärenden (dedup per ärende)

        riktiga.forEach(function (r) {
            var kw = parseKw(r.keywords);
            if (kw.length) harKw++;

            var seddaAmne = {}, seddaKat = {};
            kw.forEach(function (kid) {
                raknareEnskild[kid] = (raknareEnskild[kid] || 0) + 1;

                var post = nyckelord[String(kid)];
                var pid = post ? (post.forlder != null ? post.forlder : kid) : kid;
                if (!seddaAmne[pid]) { raknareAmne[pid] = (raknareAmne[pid] || 0) + 1; seddaAmne[pid] = true; }

                var kat = post ? post.kategori : null;
                if (kat != null && !seddaKat[kat]) {
                    raknareKat[kat] = (raknareKat[kat] || 0) + 1;
                    seddaKat[kat] = true;
                }
            });
        });

        function namn(id) { return (nyckelord[String(id)] || {}).namn || ('#' + id); }
        function toppLista(raknare, namnFn, n) {
            return Object.keys(raknare)
                .map(function (id) { return { id: id, namn: namnFn(id), antal: raknare[id] }; })
                .sort(function (a, b) { return b.antal - a.antal || a.namn.localeCompare(b.namn, 'sv'); })
                .slice(0, n);
        }

        return JSON.stringify({
            amnesomraden: toppLista(raknareAmne, namn, 3),
            enskilda: toppLista(raknareEnskild, namn, 3),
            kategorier: toppLista(raknareKat, function (id) { return NYCKELORD_KATEGORI[id] || ('Kategori #' + id); }, 3),
            har_nyckelord: harKw,
            totalt: riktiga.length
        });
    }

    var NYCKELORD_KATEGORI = {
        1: 'Transaktionstyp', 2: 'Bokföring/Redovisning', 3: 'Betalning/Bank',
        4: 'Access/Roller', 5: 'Approval/Workflow', 6: 'Integration/Tredjepart',
        7: 'Custom/Utveckling', 8: 'Symptom/Övrigt'
    };

    function hamtaArenden() {
        var sql =
            "SELECT sc.id, sc.title, sc.custevent_nic_na_case_keywords AS keywords " +
            "FROM supportcase sc ORDER BY sc.id";
        var rader = [];
        var sidor = query.runSuiteQLPaged({ query: sql, pageSize: 1000 });
        for (var i = 0; i < sidor.pageRanges.length; i++) {
            rader = rader.concat(sidor.fetch({ index: i }).data.asMappedResults());
        }
        return rader;
    }

    function hamtaNyckelord() {
        var sql =
            "SELECT id, name, custrecord_nic_na_key_parent AS parent, custrecord_nic_na_key_cat AS cat " +
            "FROM customrecord_nic_na_case_keywords ORDER BY id";
        var rader = query.runSuiteQL({ query: sql }).asMappedResults();
        var karta = {};
        rader.forEach(function (r) {
            karta[String(r.id)] = {
                namn: r.name,
                forlder: (r.parent === null || r.parent === undefined || r.parent === '') ? null : Number(r.parent),
                kategori: (r.cat === null || r.cat === undefined || r.cat === '') ? null : Number(r.cat)
            };
        });
        return karta;
    }

    function parseKw(raw) {
        if (!raw) return [];
        var set = {};
        String(raw).split(',').forEach(function (x) {
            x = x.trim();
            if (x !== '') set[Number(x)] = true;
        });
        return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
    }

    // =======================================================================
    // Rendering
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

    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function miniLista(rubrik, poster) {
        var rader = poster.map(function (p) {
            return '<li style="display:flex;justify-content:space-between;gap:8px;' +
                'padding:2px 0;border-bottom:1px solid #f0f0ee">' +
                '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                escapeHtml(p.namn) + '</span>' +
                '<span style="font-weight:600;white-space:nowrap">' + p.antal + '</span></li>';
        }).join('');
        return '' +
            '<div>' +
            '<div style="font-size:11px;color:#6b6b66;text-transform:uppercase;letter-spacing:.02em;margin-bottom:3px">' +
            escapeHtml(rubrik) + '</div>' +
            '<ul style="list-style:none;margin:0;padding:0;font-size:12px">' + (rader || '<li style="color:#999">Inga träffar</li>') + '</ul>' +
            '</div>';
    }

    function byggHtml(d) {
        return '' +
            '<div style="font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,sans-serif;padding:4px 2px 2px">' +
            '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:8px">' +
            miniLista('Ämnesområden', d.amnesomraden) +
            miniLista('Nyckelord', d.enskilda) +
            miniLista('Kategorier', d.kategorier) +
            '</div>' +
            '<div style="font-size:11px;color:#6b6b66;margin-bottom:8px">' +
            d.har_nyckelord + ' av ' + d.totalt + ' ärenden har minst ett nyckelord (hela stocken, cache max 15 min gammal)</div>' +
            '<a href="' + dashboardUrl() + '" style="display:inline-block;font-size:12px;' +
            'padding:6px 14px;border-radius:6px;background:#2a78d6;color:#fff;text-decoration:none">' +
            'Öppna full dashboard &rarr;</a>' +
            '</div>';
    }

    return { render: render };
});
