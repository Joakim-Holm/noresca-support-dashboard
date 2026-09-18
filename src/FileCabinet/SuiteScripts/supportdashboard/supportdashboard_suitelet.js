/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Supportdashboard – Suitelet
 * ===========================
 * Bygger om och visar Noresca Admins supportdashboard direkt i NetSuite, utan
 * att någon behöver köra Python/SuiteQL manuellt utanför kontot.
 *
 * Vad den gör:
 *  - GET (utan parameter)  -> visar senast genererade dashboard (en fil i File
 *    Cabinet), eller en tom startsida med en "Uppdatera"-knapp om ingen finns.
 *  - POST (eller GET med ?action=refresh) -> hämtar hela ärendestocken och
 *    nyckelordstabellen på nytt via SuiteQL, räknar om all statistik, skriver
 *    in den i samma HTML-mall som Cowork-skillen "supportdashboard" använder,
 *    sparar resultatet i File Cabinet och visar det.
 *
 * Beroenden i File Cabinet (samma mapp som det här scriptet):
 *  - dashboard_mall.html   – identisk kopia av assets/dashboard_mall.html i
 *                            Cowork-skillen. Enda källan till layout/JS/CSS;
 *                            ändras layouten, ändra där och ladda upp på nytt.
 *  - namn.json             – kurerade kund-/handläggarnamn + avtalsnivå/SDM,
 *                            samma format som data/namn.json i skillen.
 *                            Saknas filen (eller saknar den ett id) faller
 *                            scriptet tillbaka på ett automatiskt rensat namn
 *                            – se rensaKundnamn().
 *  - supportdashboard_live.html – SKAPAS/SKRIVS ÖVER av scriptet självt vid
 *                            varje "Uppdatera". Rör den inte manuellt.
 *
 * Se driftsättningsguiden (README-avsnittet i leveransen) för hur filerna
 * laddas upp och scriptet/deploymentet skapas – det kräver några klick i
 * NetSuite-gränssnittet som inte går att göra via detta script självt.
 *
 * Hela aggregeringslogiken (byggData) är en direkt, fältnamnskompatibel
 * portering av scripts/bygg_dashboard.py:s bygg()-funktion i Cowork-skillen.
 * Hålls de två i synk manuellt – ändras en beräkning i det ena stället,
 * ändra även det andra.
 */
define(['N/query', 'N/file', 'N/log', 'N/runtime', 'N/url'],
function (query, file, log, runtime, url) {

    // ---------------------------------------------------------------------
    // Etiketter – identiska med STATUS/KATEGORI/PRIORITET/SEVERITY/
    // NYCKELORD_KATEGORI i scripts/bygg_dashboard.py. Ändras en lista i
    // NetSuite (nytt statusvärde, ny kategori) ska den ändras på båda ställen.
    // ---------------------------------------------------------------------
    var STATUS = {
        1: 'New', 2: 'In Progress', 4: 'Re-Opened', 5: 'Closed',
        6: 'Väntar på kund', 8: 'Solution proposal', 9: 'Solved',
        10: 'Dev tool progress', 11: 'Change Backlog', 12: 'Paused by customer'
    };
    var KATEGORI = { 1: 'Request', 2: 'Incident', 3: 'Problem', 4: 'Error correction', 5: 'Change', 6: 'Support' };
    var PRIORITET = { 1: 'High', 2: 'Medium', 3: 'Low' };
    var SEVERITY = { 1: '1 – Kritisk', 2: '2 – Hög', 3: '3 – Medel', 4: '4 – Låg/ingen' };
    var STANGDA = [5, 9];          // Closed, Solved – räknas inte som öppen backlog
    var DEV_KATEGORIER = [5];      // Change – räknas som Arbetsart "Development"
    var TESTMONSTER = /\btest/i;   // samma ordgränsbundna mönster som Python-skriptet
    // Kategori satt på SJÄLVA nyckelordet (custrecord_nic_na_key_cat) – inte
    // ärendets eget Typ/kategori-fält (KATEGORI ovan). Se caveat i
    // references/matt-och-avvikelser.md om namnlikheten med överordnade nyckelord.
    var NYCKELORD_KATEGORI = {
        1: 'Transaktionstyp', 2: 'Bokföring/Redovisning', 3: 'Betalning/Bank',
        4: 'Access/Roller', 5: 'Approval/Workflow', 6: 'Integration/Tredjepart',
        7: 'Custom/Utveckling', 8: 'Symptom/Övrigt'
    };

    // Sökvägar i File Cabinet, relativt scriptets egen mapp. file.load({id})
    // accepterar en fullständig cabinet-sökväg som sträng, så vi slipper
    // hårdkodade interna mapp-id:n (som skiljer sig mellan konton).
    var MAPP = 'SuiteScripts/supportdashboard/';
    var MALL_PATH = MAPP + 'dashboard_mall.html';
    var NAMN_PATH = MAPP + 'namn.json';
    var LIVE_PATH = MAPP + 'supportdashboard_live.html';
    var LIVE_NAMN = 'supportdashboard_live.html';

    // =======================================================================
    // Suitelet-ingång
    // =======================================================================
    function onRequest(context) {
        var request = context.request;
        var response = context.response;
        var villUppdatera = (request.method === 'POST') || (request.parameters.action === 'refresh');

        if (villUppdatera) {
            try {
                var ts = hamtaTidsstampel();
                var html = byggDashboard(ts.datum);
                var htmlMedBanner = injiceraVerktygsfalt(html, ts.datum + ' ' + ts.tid);
                sparaGenereradFil(htmlMedBanner);
                response.write(htmlMedBanner);
            } catch (e) {
                log.error({ title: 'supportdashboard: byggfel', details: (e && e.message) || e });
                response.write(felsida(e));
            }
            return;
        }

        var cached = lasFilSakert(LIVE_PATH);
        response.write(cached || startsida());
    }

    // =======================================================================
    // Sidor (start/fel) och verktygsfältet som injiceras i den genererade
    // dashboarden. Ligger separat från assets/dashboard_mall.html i
    // Cowork-skillen, som ska förbli en ren, fristående offline-fil – all
    // NetSuite-specifik "uppdatera från servern"-UI hör hemma här, inte där.
    // =======================================================================
    function suiteletUrl() {
        var script = runtime.getCurrentScript();
        return url.resolveScript({
            scriptId: script.id,
            deploymentId: script.deploymentId,
            returnExternalUrl: false
        });
    }

    function startsida() {
        return '<!doctype html><html lang="sv"><head><meta charset="utf-8">' +
            '<title>Supportdashboard</title></head>' +
            '<body style="font-family:system-ui,sans-serif;padding:48px;max-width:640px;margin:auto;line-height:1.5">' +
            '<h1 style="font-size:20px">Supportdashboard</h1>' +
            '<p>Ingen dashboard är genererad än i den här miljön. Klicka nedan för att hämta ärendedata från ' +
            'NetSuite och bygga den första versionen. Det kan ta någon minut.</p>' +
            '<form method="post" action="' + suiteletUrl() + '">' +
            '<button type="submit" style="font:inherit;padding:10px 18px;cursor:pointer;' +
            'background:#2a78d6;color:#fff;border:none;border-radius:7px">Uppdatera dashboard</button>' +
            '</form></body></html>';
    }

    function felsida(e) {
        var meddelande = (e && e.message) ? e.message : String(e);
        return '<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Fel – Supportdashboard</title></head>' +
            '<body style="font-family:system-ui,sans-serif;padding:48px;max-width:680px;margin:auto;line-height:1.5">' +
            '<h1 style="font-size:20px">Kunde inte bygga dashboarden</h1>' +
            '<p>Något gick fel när data skulle hämtas eller räknas om. Se skriptloggen (Execution Log) för ' +
            'fullständig stacktrace. Felmeddelande:</p>' +
            '<pre style="white-space:pre-wrap;background:#f4f4f2;padding:14px;border-radius:8px;font-size:13px">' +
            escapeHtml(meddelande) + '</pre>' +
            '<p><a href="' + suiteletUrl() + '">Tillbaka till dashboarden</a></p>' +
            '</body></html>';
    }

    function injiceraVerktygsfalt(html, senastUppdaterad) {
        var toolbar =
            '<div id="ns-suitelet-bar" style="position:sticky;top:0;z-index:9999;' +
            'background:#0b0b0b;color:#fff;padding:9px 22px;display:flex;gap:16px;' +
            'align-items:center;flex-wrap:wrap;font:13px/1.4 system-ui,sans-serif">' +
            '<strong style="white-space:nowrap">Supportdashboard – NetSuite</strong>' +
            '<span style="opacity:.72;white-space:nowrap">Senast uppdaterad: ' + escapeHtml(senastUppdaterad) + '</span>' +
            '<form method="post" action="' + suiteletUrl() + '" style="margin:0 0 0 auto">' +
            '<button type="submit" style="font:inherit;padding:5px 14px;border-radius:6px;border:none;' +
            'cursor:pointer;background:#2a78d6;color:#fff">Uppdatera dashboard</button>' +
            '</form></div>';
        // Sätts in direkt efter <body ...> så resten av sidans layout (som har
        // egen sticky header) inte påverkas i övrigt.
        return html.replace(/<body[^>]*>/, function (m) { return m + toolbar; });
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    // =======================================================================
    // File Cabinet-hjälpare
    // =======================================================================
    function lasFilSakert(path) {
        try {
            return file.load({ id: path }).getContents();
        } catch (e) {
            return null;
        }
    }

    function hittaMappId() {
        // Återanvänder mallfilens mapp-id i stället för att hårdkoda ett
        // internt id, som skiljer sig mellan konton/miljöer (sandbox/prod).
        return file.load({ id: MALL_PATH }).folder;
    }

    function sparaGenereradFil(html) {
        try {
            var befintlig = file.load({ id: LIVE_PATH });
            befintlig.contents = html;
            befintlig.save();
            return;
        } catch (e) {
            // Filen finns inte sedan tidigare (första körningen) – skapa den.
        }
        var ny = file.create({
            name: LIVE_NAMN,
            fileType: file.Type.HTMLDOC,
            contents: html,
            folder: hittaMappId()
        });
        ny.isOnline = false; // åtkomst styrs av Suitelet-deploymentets roller, inte en publik länk
        ny.save();
    }

    // =======================================================================
    // NetSuite-uttag (SuiteQL). Se references/netsuite-uttag.md i Cowork-
    // skillen för bakgrunden till varje fält och fallgroparna.
    //
    // Alla datumfält TO_CHAR:as till 'YYYY-MM-DD' i själva SQL-frågan i
    // stället för att lita på klientens/kontots datumformat-inställning –
    // annars kan samma fält komma tillbaka som "16/9/2026" eller "9/16/2026"
    // beroende på inloggad användares preferenser, vilket skulle göra
    // datumjämförelserna nedan opålitliga.
    // =======================================================================
    function hamtaTidsstampel() {
        var row = query.runSuiteQL({
            query: "SELECT TO_CHAR(SYSDATE, 'YYYY-MM-DD') AS datum, TO_CHAR(SYSDATE, 'HH24:MI') AS tid FROM DUAL"
        }).asMappedResults()[0];
        return { datum: row.datum, tid: row.tid };
    }

    function hamtaArenden() {
        var sql =
            "SELECT sc.id, sc.casenumber, sc.title, sc.status, sc.priority, sc.category, " +
            "sc.custevent_nic_na_sev AS sev, sc.company, sc.assigned, " +
            "TO_CHAR(sc.datecreated, 'YYYY-MM-DD') AS datecreated, " +
            "TO_CHAR(sc.enddate, 'YYYY-MM-DD') AS enddate, " +
            "TO_CHAR(sc.supportfirstreply, 'YYYY-MM-DD') AS supportfirstreply, " +
            "TO_CHAR(sc.lastmessagedate, 'YYYY-MM-DD') AS lastmessagedate, " +
            "TO_CHAR(sc.lastcustomermessagereceived, 'YYYY-MM-DD') AS lastcustomermessagereceived, " +
            "sc.timeelapsed, sc.custevent_nic_na_case_keywords AS keywords, " +
            "TO_CHAR(sc.custevent_nic_na_case_sla_ms1_date, 'YYYY-MM-DD') AS ms1_date, " +
            "TO_CHAR(sc.custevent_nic_na_case_sla_ms2_date, 'YYYY-MM-DD') AS ms2_date, " +
            "TO_CHAR(sc.custevent_nic_na_case_sla_ms3_date, 'YYYY-MM-DD') AS ms3_date " +
            "FROM supportcase sc ORDER BY sc.id";
        var alla = [];
        var sidor = query.runSuiteQLPaged({ query: sql, pageSize: 1000 });
        for (var i = 0; i < sidor.pageRanges.length; i++) {
            var sida = sidor.fetch({ index: i });
            alla = alla.concat(sida.data.asMappedResults());
        }
        return alla;
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

    // Fyller på namn.json med automatiskt rensade namn för kund-/handläggar-id
    // som saknas i den kurerade filen (t.ex. en helt ny kund sedan filen
    // senast uppdaterades). Muterar namn-objektet in-place.
    function komplettera(namn, riktiga) {
        namn.kunder = namn.kunder || {};
        namn.anstallda = namn.anstallda || {};
        namn.sla = namn.sla || {};
        namn.sdm = namn.sdm || {};

        var kundIds = unika(riktiga.map(function (r) { return r.company; }).filter(function (v) { return v != null; }));
        var handlIds = unika(riktiga.map(function (r) { return r.assigned; }).filter(function (v) { return v != null; }));

        var saknadeKund = kundIds.filter(function (id) { return !namn.kunder.hasOwnProperty(String(id)); });
        var saknadeHandl = handlIds.filter(function (id) { return !namn.anstallda.hasOwnProperty(String(id)); });

        if (saknadeKund.length) {
            var kundrader = query.runSuiteQL({
                query: "SELECT id, entitytitle FROM entity WHERE id IN (" + saknadeKund.join(',') + ')'
            }).asMappedResults();
            kundrader.forEach(function (r) { namn.kunder[String(r.id)] = rensaKundnamn(r.entitytitle); });
            log.audit({
                title: 'supportdashboard: okända kund-id',
                details: saknadeKund.length + ' kund-id saknades i namn.json, fick automatiskt rensat namn: ' + saknadeKund.join(',')
            });
        }
        if (saknadeHandl.length) {
            var handlrader = query.runSuiteQL({
                query: "SELECT id, entityid FROM employee WHERE id IN (" + saknadeHandl.join(',') + ')'
            }).asMappedResults();
            handlrader.forEach(function (r) { namn.anstallda[String(r.id)] = r.entityid || ('#' + r.id); });
            log.audit({
                title: 'supportdashboard: okända handläggar-id',
                details: saknadeHandl.length + ' handläggar-id saknades i namn.json: ' + saknadeHandl.join(',')
            });
        }
    }

    // Enklare regel än den manuella "hämta moderbolagets namn"-processen som
    // används när namn.json kureras (se references/netsuite-uttag.md, avsnitt
    // 2) – bara en nödlösning tills någon lägger till kunden i namn.json.
    function rensaKundnamn(entitytitle) {
        var s = String(entitytitle || '').replace(/^\d+\s*/, '');
        s = s.replace(/\b(Support|Implementation|NetSuite Development)\b/gi, '').trim();
        return s || String(entitytitle || '');
    }

    function unika(lista) {
        var sedda = {}, ut = [];
        lista.forEach(function (v) { if (!sedda[v]) { sedda[v] = true; ut.push(v); } });
        return ut;
    }

    function rensaTest(rader) {
        var riktiga = [], test = [];
        rader.forEach(function (r) {
            (TESTMONSTER.test(r.title || '') ? test : riktiga).push(r);
        });
        return { riktiga: riktiga, test: test };
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
    // Datumaritmetik. Räknar dagar sedan en fast epok (UTC) i stället för att
    // låta JS Date-objekt tolkas i serverns lokala tidszon – vi bryr oss bara
    // om skillnaden mellan två datum, inte om det absoluta epoktalet.
    // =======================================================================
    function datumTillDagar(datumStr) {
        if (!datumStr) return null;
        return Math.floor(Date.UTC(
            Number(datumStr.slice(0, 4)), Number(datumStr.slice(5, 7)) - 1, Number(datumStr.slice(8, 10))
        ) / 86400000);
    }
    function dagarMellan(a, b) {
        if (!a || !b) return null;
        return datumTillDagar(b) - datumTillDagar(a);
    }
    function median(vals) {
        if (!vals.length) return 0;
        var s = vals.slice().sort(function (a, b) { return a - b; });
        var mitt = Math.floor(s.length / 2);
        return s.length % 2 ? s[mitt] : (s[mitt - 1] + s[mitt]) / 2;
    }
    function percentil(sorterade, p) {
        if (!sorterade.length) return 0;
        var k = (sorterade.length - 1) * p;
        var f = Math.floor(k), c = Math.min(f + 1, sorterade.length - 1);
        return f === c ? sorterade[f] : sorterade[f] + (sorterade[c] - sorterade[f]) * (k - f);
    }
    function max0(lista) {
        return lista.length ? Math.max.apply(null, lista) : 0;
    }

    // =======================================================================
    // Huvudaggregeringen – direkt portering av bygg() i
    // scripts/bygg_dashboard.py. Fältnamnen på varje ärendeobjekt måste vara
    // identiska med vad assets/dashboard_mall.html förväntar sig
    // (id, nr, titel, statusid, status, prioid, prio, kategoriid, kategori,
    // grupp, sevid, sev, kundid, kund, assignedid, handlaggare, sla, sdm,
    // skapad, datecreated, enddate, ms1, ms2, ms3, alder, forstasvar,
    // svarsdygn, senaste_msg, tyst_dagar, senaste_kundmsg, ledtid_h, kw).
    // =======================================================================
    function byggData(rader, namn, nyckelord, idag) {
        var kunderMap = namn.kunder || {};
        var anstalldaMap = namn.anstallda || {};
        var slaMap = namn.sla || {};
        var sdmMap = namn.sdm || {};
        var idagDagar = datumTillDagar(idag);

        var alla = rader.map(function (r) {
            var kid = (r.company !== null && r.company !== undefined) ? Number(r.company) : null;
            var aid = (r.assigned !== null && r.assigned !== undefined) ? Number(r.assigned) : null;
            var statusid = Number(r.status);
            var prioid = (r.priority !== null && r.priority !== undefined) ? Number(r.priority) : null;
            var sevid = (r.sev !== null && r.sev !== undefined) ? Number(r.sev) : null;
            var katid = (r.category !== null && r.category !== undefined) ? Number(r.category) : null;
            var datecreated = r.datecreated || null;
            var enddate = r.enddate || null;
            var ms1 = r.ms1_date || null;
            var ms2 = r.ms2_date || null;
            var ms3 = r.ms3_date || null;
            var forstasvar = r.supportfirstreply || null;
            var senasteMsg = r.lastmessagedate || null;
            var senasteKundmsg = r.lastcustomermessagereceived || null;
            var alder = datecreated ? (idagDagar - datumTillDagar(datecreated)) : null;
            var svarsdygn = dagarMellan(datecreated, forstasvar);
            var tystDagar = senasteMsg ? (idagDagar - datumTillDagar(senasteMsg)) : null;
            var ledtidH = (r.timeelapsed !== null && r.timeelapsed !== undefined) ? Number(r.timeelapsed) : null;

            return {
                id: Number(r.id),
                nr: String(r.casenumber || r.id),
                titel: r.title || '(utan titel)',
                statusid: statusid,
                status: STATUS[statusid] || ('#' + statusid),
                prioid: prioid,
                prio: PRIORITET[prioid] || '(tom)',
                kategoriid: katid,
                kategori: KATEGORI[katid] || '(tom)',
                grupp: DEV_KATEGORIER.indexOf(katid) !== -1 ? 'Development' : 'Support',
                sevid: sevid,
                sev: SEVERITY[sevid] || '(tom)',
                kundid: kid,
                kund: kid != null ? (kunderMap[String(kid)] || String(kid)) : '(okänd)',
                assignedid: aid,
                handlaggare: aid != null ? (anstalldaMap[String(aid)] || String(aid)) : '(otilldelad)',
                sla: kid != null ? (slaMap[String(kid)] || 'Ej verifierad') : 'Ej verifierad',
                sdm: kid != null ? (sdmMap[String(kid)] || 'Ej verifierad') : 'Ej verifierad',
                skapad: datecreated,
                datecreated: datecreated,
                enddate: enddate,
                ms1: ms1,
                ms2: ms2,
                ms3: ms3,
                alder: alder,
                forstasvar: forstasvar,
                svarsdygn: svarsdygn,
                senaste_msg: senasteMsg,
                tyst_dagar: tystDagar,
                senaste_kundmsg: senasteKundmsg,
                ledtid_h: ledtidH,
                kw: parseKw(r.keywords)
            };
        });

        var oppna = alla.filter(function (o) { return STANGDA.indexOf(o.statusid) === -1; });
        function sedan(dagarBak) { return idagDagar - dagarBak; }

        var nya7 = alla.filter(function (o) { return o.datecreated && datumTillDagar(o.datecreated) > sedan(7); });
        var stangda7 = alla.filter(function (o) { return o.enddate && datumTillDagar(o.enddate) > sedan(7); });
        var nya30 = alla.filter(function (o) { return o.datecreated && datumTillDagar(o.datecreated) > sedan(30); });
        var stangda30 = alla.filter(function (o) { return o.enddate && datumTillDagar(o.enddate) > sedan(30); });

        var utanForstasvar = oppna.filter(function (o) { return !o.forstasvar; });
        var medSvar = oppna.filter(function (o) { return !!o.forstasvar; });
        var sammaDag = medSvar.filter(function (o) { return o.svarsdygn === 0; });
        var inom1dag = medSvar.filter(function (o) { return (o.svarsdygn == null ? 999 : o.svarsdygn) <= 1; });

        var stangda90d = alla.filter(function (o) {
            return o.enddate && datumTillDagar(o.enddate) > sedan(90) && o.ledtid_h != null;
        });
        var ledtider = stangda90d.map(function (o) { return o.ledtid_h / 24; })
            .sort(function (a, b) { return a - b; });

        var tysta30Oppna = oppna.filter(function (o) { return (o.tyst_dagar || 0) > 30; });

        var kpi = {
            backlog: oppna.length,
            nya7: nya7.length, stangda7: stangda7.length, netto7: nya7.length - stangda7.length,
            nya30: nya30.length, stangda30: stangda30.length, netto30: nya30.length - stangda30.length,
            utan_forstasvar: utanForstasvar.length,
            samma_dag_pct: medSvar.length ? Math.round(100 * sammaDag.length / medSvar.length) : 0,
            inom_1dag_pct: medSvar.length ? Math.round(100 * inom1dag.length / medSvar.length) : 0,
            median_ledtid_d: ledtider.length ? Math.round(median(ledtider)) : 0,
            p90_ledtid_d: ledtider.length ? Math.round(percentil(ledtider, 0.9)) : 0,
            aldsta_dagar: max0(oppna.map(function (o) { return o.alder || 0; })),
            tysta30: tysta30Oppna.length
        };

        var kundnamnMedOppna = unika(oppna.map(function (o) { return o.kund; }))
            .sort(function (a, b) { return a.localeCompare(b, 'sv'); });
        var kunder = kundnamnMedOppna.map(function (k) {
            var mineAlla = alla.filter(function (o) { return o.kund === k; });
            var mineOppna = oppna.filter(function (o) { return o.kund === k; });
            var in3 = mineAlla.filter(function (o) { return o.datecreated && datumTillDagar(o.datecreated) > sedan(90); }).length;
            var in12 = mineAlla.filter(function (o) { return o.datecreated && datumTillDagar(o.datecreated) > sedan(365); }).length;
            return {
                kund: k,
                sla: mineOppna.length ? mineOppna[0].sla : 'Ej verifierad',
                sdm: mineOppna.length ? mineOppna[0].sdm : 'Ej verifierad',
                oppna: mineOppna.length,
                utan_svar: mineOppna.filter(function (o) { return !o.forstasvar; }).length,
                tysta30: mineOppna.filter(function (o) { return (o.tyst_dagar || 0) > 30; }).length,
                aldsta: max0(mineOppna.map(function (o) { return o.alder || 0; })),
                in3: in3, in12: in12,
                snitt_mnd: Math.round((in12 / 12) * 10) / 10,
                takt3: Math.round((in3 / 3) * 10) / 10
            };
        });

        var AGE_BINS = [[7, '0–7 dagar'], [30, '8–30 dagar'], [90, '31–90 dagar'], [180, '91–180 dagar'], [1e6, 'över 180 dagar']];
        function ageBucket(d) {
            for (var i = 0; i < AGE_BINS.length; i++) if (d <= AGE_BINS[i][0]) return AGE_BINS[i][1];
            return AGE_BINS[AGE_BINS.length - 1][1];
        }
        var alderDist = {};
        oppna.forEach(function (o) { var b = ageBucket(o.alder); alderDist[b] = (alderDist[b] || 0) + 1; });
        var alder = AGE_BINS.map(function (b) { return { namn: b[1], antal: alderDist[b[1]] || 0 }; });

        var datumMedSkapad = alla.filter(function (o) { return o.datecreated; })
            .map(function (o) { return o.datecreated; }).sort();
        var forsta = datumMedSkapad.length ? datumMedSkapad[0] : idag;

        return {
            snapshot: idag,
            totalt_arenden: alla.length,
            forsta_arende: forsta,
            kpi: kpi,
            oppna: oppna,
            kunder: kunder,
            alla: alla,
            alder: alder,
            nyckelord: nyckelord,
            nyckelord_kategorier: NYCKELORD_KATEGORI
        };
    }

    // =======================================================================
    // Fullständigt bygge: hämta -> rensa testärenden -> komplettera namn ->
    // aggregera -> stoppa in i mallen.
    // =======================================================================
    function byggDashboard(idag) {
        var mall = lasFilSakert(MALL_PATH);
        if (!mall) throw new Error('Hittar inte mallfilen ' + MALL_PATH + ' i File Cabinet. Se driftsättningsguiden.');

        var namnRaw = lasFilSakert(NAMN_PATH);
        var namn = namnRaw ? JSON.parse(namnRaw) : { kunder: {}, anstallda: {}, sla: {}, sdm: {} };

        var rensat = rensaTest(hamtaArenden());
        var nyckelord = hamtaNyckelord();
        komplettera(namn, rensat.riktiga);

        log.audit({
            title: 'supportdashboard: uppdatering',
            details: rensat.riktiga.length + ' ärenden inlästa, ' + rensat.test.length + ' testärenden borträknade.'
        });

        var data = byggData(rensat.riktiga, namn, nyckelord, idag);
        var payload = JSON.stringify(data);
        return mall.replace(/\/\*__DATA__\*\/[\s\S]*?\/\*__DATA__SLUT__\*\//, function () { return payload; });
    }

    var exporterat = { onRequest: onRequest };

    // Exponerar de rena hjälpfunktionerna för automatiserad testning UTANFÖR
    // NetSuite (se scripts/test_suitelet_logic.js i leveransen), skyddat av en
    // global flagga som aldrig är satt i en riktig NetSuite-körning. NetSuite
    // självt anropar bara onRequest ovan – det här är en ofarlig testkrok,
    // inte en del av produktionsbeteendet.
    if (typeof __TEST_SUPPORTDASHBOARD__ !== 'undefined' && __TEST_SUPPORTDASHBOARD__) {
        exporterat._test = {
            byggData: byggData,
            rensaTest: rensaTest,
            parseKw: parseKw,
            komplettera: komplettera,
            rensaKundnamn: rensaKundnamn,
            byggDashboard: byggDashboard,
            injiceraVerktygsfalt: injiceraVerktygsfalt
        };
    }

    return exporterat;
});
