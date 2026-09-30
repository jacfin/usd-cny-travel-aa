const SUPPORTED = ['EUR','GBP','JPY','CAD','AUD','MXN','CHF','THB','VND','SGD','KRW','HKD','TWD','MYR','INR','NZD','ARS','BRL','PEN','BOB','CLP'];
const BANK_URLS = [
  'https://www.bankcomm.com/BankCommSite/default.shtml',
  'https://m.bankcomm.com/',
  'https://www.bankcomm.com/BankCommSite/index.shtml',
];
const REPUBLISHED_URLS = [
  'https://www.usdrate.top/BANKCOMM_USD.html',
  'https://www.usdrate.top/BANKCOMM.html',
];
const MASTERCARD_URL = 'https://www.mastercard.us/settlement/currencyrate/conversion-rate';
const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const BROAD_FX_URL = 'https://open.er-api.com/v6/latest/USD';

let dbReady = false;
let usdCache = null;
const mastercardCache = new Map();

function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' } });
}
function fail(message, status=400) { return json({ error: message }, status); }
function id() { return crypto.randomUUID(); }

async function initDb(env) {
  if (dbReady) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)'),
    env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS people_name_nocase ON people(name COLLATE NOCASE)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS bills (id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL, amount REAL NOT NULL, payer_id TEXT NOT NULL, share_ids TEXT NOT NULL, note TEXT NOT NULL DEFAULT \'\', currency TEXT NOT NULL DEFAULT \'USD\', usd_amount REAL NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS bills_date_idx ON bills(date)'),
  ]);
  dbReady = true;
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'user-agent':'Mozilla/5.0 (compatible; USD-CNY-Travel-AA/1.0)', 'accept':'text/html,application/xhtml+xml,application/json' } });
  if (!r.ok) throw new Error('HTTP '+r.status);
  return r.text();
}
function stripHtml(s) {
  return s.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
}
function parseBankRate(text) {
  const plain=stripHtml(text);
  const m=plain.match(/美元\s*USD\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)/i);
  if (!m) throw new Error('USD spot selling rate not found');
  const rate=Number(m[2]);
  if (!(rate>0)) throw new Error('invalid USD selling rate');
  return rate>=20 ? rate/100 : rate;
}
function parseRepublished(text) {
  const plain=stripHtml(text);
  const m=plain.match(/1美元\s*=\s*([0-9]+(?:\.[0-9]+)?)元人民币/i);
  if (!m) throw new Error('republished rate not found');
  const rate=Number(m[1]);
  if (!(rate>0)) throw new Error('invalid republished rate');
  return rate;
}
async function getUsdCny() {
  if (usdCache && Date.now()-usdCache.cachedAt < 3600000) return { ...usdCache, cached:true };
  for (const url of BANK_URLS) {
    try {
      const rate=parseBankRate(await fetchText(url));
      usdCache={ rate, source:'交通银行（中国内地）官网美元现汇卖出价', sourceUrl:url, updatedAt:new Date().toISOString(), cachedAt:Date.now() };
      return { ...usdCache, cached:false };
    } catch {}
  }
  for (const url of REPUBLISHED_URLS) {
    try {
      const rate=parseRepublished(await fetchText(url));
      usdCache={ rate, source:'交通银行牌价转载源（数据标注来源为交通银行）', sourceUrl:url, updatedAt:new Date().toISOString(), cachedAt:Date.now() };
      return { ...usdCache, cached:false };
    } catch {}
  }
  if (usdCache) return { ...usdCache, cached:true, stale:true };
  throw new Error('交通银行美元现汇卖出价暂时无法获取');
}
async function ecbRate(currency) {
  const xml=await fetchText(ECB_DAILY_URL);
  const u=xml.match(/<Cube\s+currency=['"]USD['"]\s+rate=['"]([0-9]+(?:\.[0-9]+)?)['"]\s*\/>/i);
  const usdPerEur=Number(u?.[1]);
  if (!(usdPerEur>0)) throw new Error('ECB USD reference unavailable');
  if (currency==='EUR') return usdPerEur;
  const m=xml.match(new RegExp(`<Cube\\\\s+currency=['"]${currency}['"]\\\\s+rate=['"]([0-9]+(?:\\\\.[0-9]+)?)['"]\\\\s*\\/>`, 'i'));
  const units=Number(m?.[1]);
  if (!(units>0)) throw new Error('ECB currency reference unavailable');
  return usdPerEur/units;
}
async function broadRate(currency) {
  const data=await (await fetch(BROAD_FX_URL)).json();
  const units=Number(data?.rates?.[currency]);
  if (!(units>0)) throw new Error('public FX reference unavailable');
  return 1/units;
}
async function getMastercard(currency) {
  const cached=mastercardCache.get(currency);
  if (cached && Date.now()-cached.cachedAt<600000) return { ...cached, cached:true };
  const date=new Date().toISOString().slice(0,10);
  try {
    const url=`${MASTERCARD_URL}?fxDate=${date}&transCurr=${currency}&crdhldBillCurr=USD&bankFee=0&transAmt=1`;
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0','accept':'application/json,text/plain,*/*'}});
    if (r.ok) {
      const data=await r.json();
      const rate=Number(data?.data?.conversionRate);
      if (rate>0) {
        const out={rate,updatedAt:new Date().toISOString(),source:'Mastercard 官方货币转换器',cachedAt:Date.now()};
        mastercardCache.set(currency,out);
        return {...out,cached:false};
      }
    }
  } catch {}
  try {
    const rate=await ecbRate(currency);
    return {rate,updatedAt:new Date().toISOString(),source:'ECB 欧元参考汇率（临时中转参考，非 Mastercard）',cached:false};
  } catch {}
  const rate=await broadRate(currency);
  return {rate,updatedAt:new Date().toISOString(),source:'公开市场参考汇率（临时中转参考，非 Mastercard）',cached:false};
}

function personRow(row) { return { id:row.id, name:row.name }; }
function billRow(row) {
  return { id:row.id, date:row.date, title:row.title, amount:Number(row.amount), payerId:row.payer_id, shareIds:JSON.parse(row.share_ids||'[]'), note:row.note||'', currency:row.currency||'USD', usdAmount:Number(row.usd_amount) };
}
async function listPeople(env) {
  const r=await env.DB.prepare('SELECT id,name FROM people ORDER BY rowid').all();
  return r.results.map(personRow);
}
async function listBills(env) {
  const r=await env.DB.prepare('SELECT id,date,title,amount,payer_id,share_ids,note,currency,usd_amount FROM bills ORDER BY date DESC, rowid DESC').all();
  return r.results.map(billRow);
}

async function handleApi(request, env) {
  await initDb(env);
  const u=new URL(request.url);
  const path=u.pathname;
  const method=request.method;

  if (method==='GET' && path==='/api/rates/usd-cny') {
    try { return json(await getUsdCny()); } catch(e) { return fail(e?.message||'rate unavailable',503); }
  }
  if (method==='GET' && path==='/api/rates/mastercard') {
    const currency=(u.searchParams.get('currency')||'EUR').toUpperCase();
    if (!SUPPORTED.includes(currency)) return fail('暂不支持该币种',400);
    try {
      const r=await getMastercard(currency);
      return json({currency,rate:r.rate,quote:'USD',source:r.source,updatedAt:r.updatedAt,cached:r.cached});
    } catch(e) { return fail('Mastercard 官方汇率暂时无法获取',503); }
  }

  if (method==='GET' && path==='/api/people') return json({people:await listPeople(env)});
  if (method==='POST' && path==='/api/people') {
    const b=await request.json().catch(()=>({}));
    const name=String(b?.name||'').trim();
    if (!name) return fail('name is required');
    const exists=await env.DB.prepare('SELECT id FROM people WHERE name=? COLLATE NOCASE').bind(name).first();
    if (exists) return fail('person already exists',409);
    const person={id:id(),name,created_at:new Date().toISOString()};
    await env.DB.prepare('INSERT INTO people(id,name,created_at) VALUES(?,?,?)').bind(person.id,person.name,person.created_at).run();
    return json({id:person.id,name:person.name},201);
  }
  const personMatch=path.match(/^\/api\/people\/([^/]+)$/);
  const resetMatch=path.match(/^\/api\/people\/([^/]+)\/settlement-reset$/);
  if (resetMatch && method==='DELETE') {
    const pid=decodeURIComponent(resetMatch[1]);
    const person=await env.DB.prepare('SELECT id,name FROM people WHERE id=?').bind(pid).first();
    if (!person) return fail('person not found',404);
    const bills=await listBills(env);
    const payerBills=bills.filter(b=>b.payerId===pid);
    if (payerBills.length) return fail('该人员是历史账单付款人。为保护付款记录，个人清算重置不会删除或改动这些账单。请先处理付款人记录。',409);
    const affected=bills.filter(b=>b.shareIds.includes(pid));
    if (affected.some(b=>b.shareIds.length<=1)) return fail('该人员是某笔账单唯一承担人，无法在不破坏历史账单的情况下移除。请先修改该账单的分摊人员。',409);
    for (const b of affected) {
      const next=b.shareIds.filter(x=>x!==pid);
      await env.DB.prepare('UPDATE bills SET share_ids=? WHERE id=?').bind(JSON.stringify(next),b.id).run();
    }
    await env.DB.prepare('DELETE FROM people WHERE id=?').bind(pid).run();
    return json({ok:true,deletedBills:0,updatedBills:affected.length,deletedPerson:person.name});
  }
  if (personMatch && method==='PUT') {
    const pid=decodeURIComponent(personMatch[1]);
    const b=await request.json().catch(()=>({}));
    const name=String(b?.name||'').trim();
    if (!name) return fail('name is required');
    const old=await env.DB.prepare('SELECT id FROM people WHERE id=?').bind(pid).first();
    if (!old) return fail('person not found',404);
    const exists=await env.DB.prepare('SELECT id FROM people WHERE name=? COLLATE NOCASE AND id<>?').bind(name,pid).first();
    if (exists) return fail('person already exists',409);
    await env.DB.prepare('UPDATE people SET name=? WHERE id=?').bind(name,pid).run();
    return json({ok:true});
  }
  if (personMatch && method==='DELETE') {
    const pid=decodeURIComponent(personMatch[1]);
    const used=await env.DB.prepare("SELECT id FROM bills WHERE payer_id=? OR instr(share_ids, ?) > 0 LIMIT 1").bind(pid,'"'+pid+'"').first();
    if (used) return fail('person is used by history',409);
    const r=await env.DB.prepare('DELETE FROM people WHERE id=?').bind(pid).run();
    return r.meta?.changes ? json({ok:true}) : fail('delete failed',500);
  }

  if (method==='GET' && path==='/api/bills') return json({bills:await listBills(env)});
  if (method==='POST' && path==='/api/bills') {
    const b=await request.json().catch(()=>({}));
    if (!b?.date || !b?.title || !(Number(b.amount)>0) || !b?.payerId || !Array.isArray(b.shareIds) || !b.shareIds.length) return fail('invalid bill',400);
    const usd=Number(b.usdAmount ?? b.amount);
    if (!(usd>0)) return fail('invalid usdAmount',400);
    const bill={id:id(),date:String(b.date),title:String(b.title).trim(),amount:Number(b.amount),payerId:String(b.payerId),shareIds:b.shareIds.map(String),note:String(b.note||''),currency:String(b.currency||'USD'),usdAmount:usd};
    await env.DB.prepare('INSERT INTO bills(id,date,title,amount,payer_id,share_ids,note,currency,usd_amount) VALUES(?,?,?,?,?,?,?,?,?)').bind(bill.id,bill.date,bill.title,bill.amount,bill.payerId,JSON.stringify(bill.shareIds),bill.note,bill.currency,bill.usdAmount).run();
    return json({id:bill.id},201);
  }
  const billMatch=path.match(/^\/api\/bills\/([^/]+)$/);
  if (billMatch && method==='PUT') {
    const bid=decodeURIComponent(billMatch[1]);
    const b=await request.json().catch(()=>({}));
    if (!b?.date || !b?.title || !(Number(b.amount)>0) || !b?.payerId || !Array.isArray(b.shareIds) || !b.shareIds.length) return fail('invalid bill',400);
    const usd=Number(b.usdAmount ?? b.amount);
    if (!(usd>0)) return fail('invalid usdAmount',400);
    const r=await env.DB.prepare('UPDATE bills SET date=?,title=?,amount=?,payer_id=?,share_ids=?,note=?,currency=?,usd_amount=? WHERE id=?').bind(String(b.date),String(b.title).trim(),Number(b.amount),String(b.payerId),JSON.stringify(b.shareIds.map(String)),String(b.note||''),String(b.currency||'USD'),usd,bid).run();
    return r.meta?.changes ? json({ok:true}) : fail('bill not found',404);
  }
  if (method==='DELETE' && path==='/api/bills') {
    const r=await env.DB.prepare('DELETE FROM bills').run();
    return json({ok:true,deleted:r.meta?.changes||0});
  }
  if (billMatch && method==='DELETE') {
    const bid=decodeURIComponent(billMatch[1]);
    const r=await env.DB.prepare('DELETE FROM bills WHERE id=?').bind(bid).run();
    return r.meta?.changes ? json({ok:true}) : fail('delete failed',500);
  }
  return fail('not found',404);
}

export default {
  async fetch(request, env) {
    const u=new URL(request.url);
    if (u.pathname.startsWith('/api/')) return handleApi(request,env);
    return env.ASSETS.fetch(request);
  }
};
