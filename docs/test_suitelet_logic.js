/**
 * Kör den porterade SuiteScript-aggregeringen (byggData m.fl.) i Node, mot
 * exakt samma riktiga NetSuite-data som senast användes för att bygga
 * Noresca_supportdashboard_2026-09-18.html via scripts/bygg_dashboard.py
 * (nu inkl. custevent_nic_na_case_sla_ms1_date/_ms2_date/_ms3_date, tillagda
 * 2026-09-18 för de tre nya milstolpslinjerna i sektion 4), och jämför
 * nyckeltalen. Ingen SuiteScript-runtime finns här, så N/query, N/file,
 * N/log, N/runtime och N/url stubbas ut med minimala fejkade
 * implementationer byggda på riktiga, redan hämtade svar.
 *
 * Körs manuellt vid behov: node test_suitelet_logic.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DATA_DIR = path.join(__dirname, '..', 'data');

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

// ---- Fixturer: samma data som bygg_dashboard.py körde mot 2026-09-16 ----
const page1 = (() => { const d = readJson(path.join(DATA_DIR, 'raw_page1.txt')); return d.data || d; })();
const page2 = (() => { const d = readJson(path.join(DATA_DIR, 'raw_page2.txt')); return d.data || d; })();
const namn = readJson(path.join(DATA_DIR, 'namn.json'));
const nyckelordMall = readJson(path.join(DATA_DIR, 'nyckelord.json')); // {"<id>": {namn,forlder,kategori}}
const mallHtml = fs.readFileSync(path.join(__dirname, '..', 'assets', 'dashboard_mall.html'), 'utf8');

// dedupe id (samma som las_arenden() i Python)
const casesById = new Map();
[...page1, ...page2].forEach(r => casesById.set(r.id, r));
const alla_rader = [...casesById.values()];

// Bygg om till råa keyword-tabellrader {id,name,parent,cat} som hamtaNyckelord() förväntar sig
const nyckelordRader = Object.entries(nyckelordMall).map(([id, v]) => ({
    id: Number(id), name: v.namn, parent: v.forlder, cat: v.kategori
}));

// ---- Stubbar för N/-modulerna ----
const fakeFiles = {
    'SuiteScripts/supportdashboard/dashboard_mall.html': mallHtml,
    'SuiteScripts/supportdashboard/namn.json': JSON.stringify(namn)
};

function makeMappedResultSet(rows) {
    return { asMappedResults: () => rows };
}

const N_query = {
    runSuiteQL: ({ query: sql }) => {
        if (/FROM DUAL/i.test(sql)) {
            return makeMappedResultSet([{ datum: '2026-09-18', tid: '12:00' }]);
        }
        if (/customrecord_nic_na_case_keywords/i.test(sql)) {
            return makeMappedResultSet(nyckelordRader);
        }
        if (/FROM entity WHERE/i.test(sql)) {
            return makeMappedResultSet([]); // alla kund-id finns redan i namn.json i det här testet
        }
        if (/FROM employee WHERE/i.test(sql)) {
            return makeMappedResultSet([]); // alla handläggar-id finns redan i namn.json
        }
        throw new Error('Oväntad SuiteQL i testet: ' + sql);
    },
    runSuiteQLPaged: ({ query: sql, pageSize }) => {
        assert(/FROM supportcase/i.test(sql), 'förväntade ärende-frågan');
        const pages = [];
        for (let i = 0; i < alla_rader.length; i += pageSize) pages.push(alla_rader.slice(i, i + pageSize));
        return {
            pageRanges: pages.map((_, i) => i),
            fetch: ({ index }) => ({ data: makeMappedResultSet(pages[index]) })
        };
    }
};

const N_file = {
    Type: { HTMLDOC: 'HTMLDOC' },
    load: ({ id }) => {
        if (!(id in fakeFiles)) { const e = new Error('no such file: ' + id); throw e; }
        return { getContents: () => fakeFiles[id], folder: -100, contents: fakeFiles[id], save: () => 1 };
    },
    create: (opts) => ({ isOnline: true, save: () => { fakeFiles['SuiteScripts/supportdashboard/' + opts.name] = opts.contents; return 999; } })
};

const N_log = { error: () => {}, audit: (o) => console.log('  [audit]', o.details || o.title) };
const N_runtime = { getCurrentScript: () => ({ id: 'customscript_test', deploymentId: 'customdeploy_test' }) };
const N_url = { resolveScript: () => '/app/site/hosting/scriptlet.nl?script=test&deploy=1' };

// ---- Minimal AMD-shim för att ladda supportdashboard_suitelet.js ----
global.__TEST_SUPPORTDASHBOARD__ = true;
let moduleExports = null;
global.define = function (deps, factory) {
    const map = { 'N/query': N_query, 'N/file': N_file, 'N/log': N_log, 'N/runtime': N_runtime, 'N/url': N_url };
    const args = deps.map(d => map[d]);
    moduleExports = factory.apply(null, args);
};

const src = fs.readFileSync(path.join(__dirname, 'supportdashboard_suitelet.js'), 'utf8');
new Function('define', src)(global.define);

const T = moduleExports._test;
assert(T, 'testkroken exponerades inte – kontrollera __TEST_SUPPORTDASHBOARD__-flaggan');

// ---- Kör hela bygget end-to-end (byggDashboard) ----
const html = T.byggDashboard('2026-09-18');
const m = html.match(/window\.__DATA__=(\{[\s\S]*?\});<\/script>/);
assert(m, 'kunde inte hitta window.__DATA__ i den genererade HTML:en');
const DATA = JSON.parse(m[1]);

console.log('--- Resultat från portad SuiteScript-logik (2026-09-18) ---');
console.log('totalt_arenden:', DATA.totalt_arenden, '(förväntat 1530, dvs 1605 - 75 testärenden)');
console.log('öppna (backlog):', DATA.kpi.backlog, '(förväntat 77)');
console.log('utan_forstasvar:', DATA.kpi.utan_forstasvar, '(förväntat 8)');
console.log('tysta30:', DATA.kpi.tysta30, '(förväntat 24)');
console.log('netto30:', DATA.kpi.netto30, '(förväntat -9)');
console.log('antal kunder-rader:', DATA.kunder.length);
console.log('nyckelord-poster:', Object.keys(DATA.nyckelord).length, '(förväntat 86)');
console.log('nyckelord_kategorier:', DATA.nyckelord_kategorier);

// ---- Hårda jämförelser mot de kända, redan verifierade Python-talen ----
assert.strictEqual(DATA.totalt_arenden, 1530, 'totalt_arenden matchar inte Python-bygget');
assert.strictEqual(DATA.kpi.backlog, 77, 'öppen backlog matchar inte Python-bygget');
assert.strictEqual(DATA.kpi.utan_forstasvar, 8, 'utan_forstasvar matchar inte Python-bygget');
assert.strictEqual(DATA.kpi.tysta30, 24, 'tysta30 matchar inte Python-bygget');
assert.strictEqual(DATA.kpi.netto30, -9, 'netto30 matchar inte Python-bygget');
assert.strictEqual(Object.keys(DATA.nyckelord).length, 86, 'antal nyckelord matchar inte');

// ---- NYTT (2026-09-18): MS1/MS2/MS3-milstolpsdatumen för sektion 4 ----
// Kontrollerar att byggData() i SuiteScript-porteringen för igenom ms1/ms2/
// ms3 oförändrade från SuiteQL-svaret, precis som enddate/datecreated redan
// gjorde – ingen omvandlingslogik att jämföra mot Python för, båda sidor
// bara passerar fältet vidare. Verifieras mot ett konkret, känt ärende
// (case 1654, internt id 152705, status Solved) vars MS-datum lästes direkt
// från NetSuite i samma session som denna testkörning skrevs om.
const case1654 = DATA.alla.find(o => o.id === 152705);
assert(case1654, 'hittade inte testärendet case 1654 (id 152705) i DATA.alla');
assert.strictEqual(case1654.ms1, '2026-09-16', 'ms1 för case 1654 matchar inte NetSuite');
assert.strictEqual(case1654.ms2, '2026-09-16', 'ms2 för case 1654 matchar inte NetSuite');
assert.strictEqual(case1654.ms3, '2026-09-16', 'ms3 för case 1654 matchar inte NetSuite');
assert.strictEqual(case1654.status, 'Solved', 'statusetiketten för case 1654 matchar inte');
// Ett ärende som aldrig nått en milstolpe ska ge null, inte tomt/undefined,
// så att bucketMonths() i dashboard_mall.html (som bara testar sanningsvärde
// på strängen) beter sig identiskt oavsett hur fältet saknades.
const utanMs = DATA.alla.find(o => o.ms1 == null);
assert(utanMs !== undefined, 'förväntade minst ett ärende utan ms1 i testdatan');
assert.strictEqual(utanMs.ms1, null, 'ärende utan ms1-datum ska ge null, inte tom sträng/undefined');

// ---- Oberoende omräkning av "vanligaste kategorierna" (samma logik som
// grupperaKategori i dashboard_mall.html), för att jämföra med den tidigare
// Playwright-verifieringen av samma feature i webbläsaren ----
function kwKategori(id) { const k = DATA.nyckelord[id]; return (k && k.kategori != null) ? k.kategori : null; }
const grupper = {};
DATA.alla.forEach(o => {
    const sedda = new Set();
    (o.kw || []).forEach(kid => {
        const kat = kwKategori(kid);
        if (kat == null) return;
        if (!grupper[kat]) grupper[kat] = new Set();
        if (!sedda.has(kat)) { grupper[kat].add(o.id); sedda.add(kat); }
    });
});
const top5kat = Object.entries(grupper).map(([kat, set]) => ({ kat, antal: set.size }))
    .sort((a, b) => b.antal - a.antal).slice(0, 5);
console.log('Topp 5 kategorier (SuiteScript-portering):');
top5kat.forEach(t => console.log('  ', DATA.nyckelord_kategorier[t.kat], '->', t.antal));
assert.strictEqual(top5kat[0].antal, 355, 'Transaktionstyp-antalet matchar inte tidigare Playwright-verifiering');
assert.strictEqual(top5kat[1].antal, 184, 'Bokföring/Redovisning-antalet matchar inte tidigare Playwright-verifiering');

// ---- Kontrollera verktygsfältet separat (injiceras av onRequest, inte av
// byggDashboard() själv – se koden) och att det bara ger en <body>-tagg ----
assert(!html.includes('ns-suitelet-bar'), 'byggDashboard() ska inte innehålla verktygsfältet ännu');
const medBanner = T.injiceraVerktygsfalt(html, '2026-09-18 12:00');
assert(medBanner.includes('ns-suitelet-bar'), 'verktygsfältet injicerades inte');
assert(medBanner.includes('Uppdatera dashboard'), 'uppdatera-knappen saknas i verktygsfältet');
// html.replace(/<body[^>]*>/, ...) utan global-flagga träffar bara den FÖRSTA
// <body>-taggen (den riktiga, rad ~157) – inte det oskyldiga "<body>"-strängen
// som toXLS() bygger som text längre ner i JS-koden (rad ~461, Excel-export).
// Kontrollera därför att bannern bara injicerades en gång, inte att texten
// "<body" bara förekommer en gång i hela dokumentet.
assert.strictEqual((medBanner.match(/ns-suitelet-bar/g) || []).length, 1, 'verktygsfältet injicerades mer än en gång');
const forstaBodyIx = medBanner.indexOf('<body>');
const bannerIx = medBanner.indexOf('ns-suitelet-bar');
assert(bannerIx > forstaBodyIx && bannerIx < forstaBodyIx + 200,
    'verktygsfältet hamnade inte direkt efter den riktiga <body>-taggen (rad ~157), inte textsträngen i toXLS() längre ner');

console.log('\nALLA TESTER GRÖNA.');

// Skriv även en färsk förhandsgranskning av den genererade sidan (inkl.
// verktygsfältet) till fil, så att den kan skärmdumpas/skickas utan att
// någon riktig NetSuite-miljö behövs.
fs.writeFileSync(path.join(__dirname, 'suitelet_generated_preview.html'), medBanner, 'utf8');
console.log('Skrev suitelet_generated_preview.html.');
