import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { api } from './api';
import './index.css';


type RateResponse = { rate: number; source: string; updatedAt: string; cached?: boolean; stale?: boolean };
type MastercardResponse = { currency: string; rate: number; quote: 'USD'; source: string; updatedAt: string; cached?: boolean };

const FIXED_FEE = 0.1;
const RATE_PARSER_VERSION = 'sell-column-v7';
const CURRENCIES = [
  ['USD', '美元'], ['EUR', '欧元'], ['GBP', '英镑'], ['JPY', '日元'], ['CAD', '加元'],
  ['AUD', '澳元'], ['MXN', '墨西哥比索'], ['CHF', '瑞士法郎'],
  ['THB', '泰铢'], ['VND', '越南盾'], ['SGD', '新加坡元'], ['KRW', '韩元'],
  ['HKD', '港币'], ['TWD', '新台币'], ['MYR', '马来西亚林吉特'], ['INR', '印度卢比'], ['NZD', '新西兰元'],
  ['ARS', '阿根廷比索'], ['BRL', '巴西雷亚尔'], ['PEN', '秘鲁索尔'], ['BOB', '玻利维亚诺'], ['CLP', '智利比索'],
] as const;

function ConverterPage() {
  const [rate, setRate] = useState<number | null>(null);
  const [source, setSource] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(() => localStorage.getItem('usd_cny_last_currency') || 'USD');
  const [mastercardRate, setMastercardRate] = useState<number | null>(null);
  const [mastercardUpdatedAt, setMastercardUpdatedAt] = useState('');
  const [feeEnabled, setFeeEnabled] = useState(() => localStorage.getItem('usd_cny_fee_enabled') === '1');
  const [aaPeople, setAaPeople] = useState(() => {
    const saved = Number(localStorage.getItem('aa_people'));
    return Number.isInteger(saved) && saved >= 2 && saved <= 6 ? saved : 2;
  });
  const [status, setStatus] = useState('正在获取实时汇率…');
  const [updatedAt, setUpdatedAt] = useState('');

  useEffect(() => {
    localStorage.setItem('usd_cny_fee_enabled', feeEnabled ? '1' : '0');
  }, [feeEnabled]);

  const applyRate = (data: RateResponse) => {
    if (!Number.isFinite(data.rate) || data.rate <= 0) throw new Error('invalid rate');
    setRate(data.rate);
    setSource(data.source);
    setUpdatedAt(data.updatedAt);
    localStorage.setItem('usd_cny_last_rate', String(data.rate));
    localStorage.setItem('usd_cny_last_updated_at', data.updatedAt);
  };

  const loadUsdCny = async (forceRefresh = false) => {
    setStatus(forceRefresh ? '正在刷新交通银行牌价…' : '正在后台更新交通银行牌价…');
    try {
      const response = await api.get(`/api/rates/usd-cny?force=${forceRefresh ? '1' : '0'}`);
      const data = response.data as RateResponse;
      applyRate(data);
      setStatus(data.stale ? '交通银行暂时不可用，显示上次成功值' : data.cached ? '交通银行汇率已快速加载' : '交通银行实时汇率已更新');
    } catch {
      setStatus('交通银行美元现汇卖出价获取失败，请点击“立即刷新”重试');
    }
  };

  const loadMastercard = async (nextCurrency: string) => {
    setStatus(`正在获取 Mastercard ${nextCurrency}→USD 汇率…`);
    try {
      const response = await api.get(`/api/rates/mastercard?currency=${nextCurrency}`);
      const data = response.data as MastercardResponse;
      if (!Number.isFinite(data.rate) || data.rate <= 0) throw new Error('invalid mastercard rate');
      setMastercardRate(data.rate);
      setMastercardUpdatedAt(data.updatedAt);
      const sourceLabel = data.source.includes('非 Mastercard') ? '参考汇率' : 'Mastercard';
      setStatus(data.cached ? `${sourceLabel} ${nextCurrency}→USD 已快速加载` : `${sourceLabel} ${nextCurrency}→USD 已更新`);
    } catch {
      setMastercardRate(null);
      setMastercardUpdatedAt('');
      setStatus(`Mastercard ${nextCurrency}→USD 暂时无法获取`);
    }
  };

  useEffect(() => {
    const savedParserVersion = localStorage.getItem('usd_cny_rate_parser_version');
    if (savedParserVersion !== RATE_PARSER_VERSION) {
      localStorage.removeItem('usd_cny_last_rate');
      localStorage.removeItem('usd_cny_last_updated_at');
      localStorage.setItem('usd_cny_rate_parser_version', RATE_PARSER_VERSION);
    }
    const cached = Number(localStorage.getItem('usd_cny_last_rate'));
    const cachedAt = localStorage.getItem('usd_cny_last_updated_at');
    if (Number.isFinite(cached) && cached > 0) {
      setRate(cached);
      setSource('交通银行（中国内地）官网美元现汇卖出价 · 上次成功值');
      if (cachedAt) setUpdatedAt(cachedAt);
      setStatus('正在后台更新交通银行牌价…');
    }
    void loadUsdCny(false);
    const timer = window.setInterval(() => void loadUsdCny(false), 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (currency === 'USD') {
      setMastercardRate(null);
      setMastercardUpdatedAt('');
      return;
    }
    void loadMastercard(currency);
  }, [currency]);

  const input = Number(amount) || 0;
  const feeMultiplier = feeEnabled ? (1 + FIXED_FEE / 100) : 1;
  const result = currency === 'USD'
    ? rate ? input * rate * feeMultiplier : null
    : rate && mastercardRate ? input * mastercardRate * rate * feeMultiplier : null;

  return (
    <main className="wrap">
      <section className="card hero">
        <h1>信用卡多币种 ⇄ CNY 结算计算器</h1>
        <p className="sub">Mastercard → USD → CNY · 交通银行美元现汇卖出价 · 自动缓存</p>
        <div className="rate">{rate ? rate.toFixed(4) : '加载中…'}</div>
        <div className="muted">交通银行中国内地美元现汇卖出价（1 USD）</div>
        <div className="stats">
          <div><span>交通银行 USD/CNY</span><b>{rate ? rate.toFixed(4) : '—'}</b></div>
          <div><span>Mastercard 中转</span><b>{currency === 'USD' ? '不经过' : `${currency} → USD`}</b></div>
          <div><span>提现手续费</span><b>{feeEnabled ? `+${FIXED_FEE}% 已启用` : '未启用'}</b></div>
          <div><span>汇率调整</span><b>不调整</b></div>
        </div>
        <div className="formula">
          {currency === 'USD'
            ? `USD → CNY：USD金额 × 交通银行卖出价 × ${feeMultiplier.toFixed(4)}`
            : `${currency} → USD → CNY：${currency}金额 × Mastercard ${currency}→USD × 交通银行 USD/CNY × ${feeMultiplier.toFixed(4)}`}
          <br />
          <strong>提现手续费：+{FIXED_FEE}% · {feeEnabled ? '已启用' : '未启用'}</strong>
        </div>
      </section>

      <section className="card">
        <div className="converter currencyPicker">
          <label>
            来源货币
            <select value={currency} onChange={e => { const next = e.target.value; setCurrency(next); localStorage.setItem('usd_cny_last_currency', next); setAmount(''); }}>
              {CURRENCIES.map(([code, name]) => <option key={code} value={code}>{code} · {name}</option>)}
            </select>
          </label>
        </div>
        <div className="converter">
          <label>
            {currency}
            <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" type="number" />
          </label>
          <span className="swap">→</span>
          <label>
            CNY
            <input readOnly value={result === null ? '—' : result.toFixed(2)} />
          </label>
        </div>
        {currency !== 'USD' && (
          <div className="formula">
            <strong>Mastercard {currency}→USD：{mastercardRate ? mastercardRate.toFixed(6) : '—'}</strong>
            {mastercardUpdatedAt ? ` · ${new Date(mastercardUpdatedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}
          </div>
        )}
        <div className="buttons">
          <button className={feeEnabled ? 'active' : ''} onClick={() => setFeeEnabled(v => !v)}>
            <span>提现手续费 +0.1%：</span>
            <span>{feeEnabled ? '已启用' : '未启用'}</span>
          </button>
          <button onClick={() => void loadUsdCny(true)}>立即刷新</button>
        </div>
        <p className={status.includes('失败') || status.includes('无法') ? 'status err' : 'status'}>
          {status}{updatedAt ? ` · ${new Date(updatedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}
        </p>
      </section>

      <section className="card aa-card">
        <h2>人均计算器</h2>
        <p className="sub">把上面的换算结果按人数平分，适合旅行时多人 AA。</p>
        <div className="aa-source">
          <span>当前可分摊金额</span>
          <b>{result === null ? '—' : `${result.toFixed(2)} CNY`}</b>
        </div>
        <div className="aa-label">选择人数</div>
        <div className="people-buttons">
          {Array.from({ length: 5 }, (_, index) => index + 2).map(person => (
            <button key={person} className={aaPeople === person ? 'active' : ''} onClick={() => {
              setAaPeople(person);
              localStorage.setItem('aa_people', String(person));
            }}>
              {person}人
            </button>
          ))}
        </div>
        <div className="aa-result">
          <span>人均费用</span>
          <strong>{result === null ? '—' : `${(result / aaPeople).toFixed(2)} CNY`}</strong>
        </div>
      </section>

      <section className="card settings">
        <div className="fixed-setting"><span>USD/CNY来源</span><b>交通银行中国内地现汇卖出价</b></div>
        <div className="fixed-setting"><span>其他币种中转</span><b>Mastercard → USD → CNY</b></div>
        <div className="fixed-setting"><span>汇率浮动</span><b>0%</b></div>
        <div className="fixed-setting"><span>提现手续费</span><b>{feeEnabled ? '+0.1%（已启用）' : '0%（未启用）'}</b></div>
        <p className="small">USD→CNY 使用交通银行中国内地官网美元现汇卖出价；其他币种模拟 Mastercard 先换 USD，再按交通银行 USD/CNY 卖出价换成人民币。提现手续费 +0.1% 可手动启用或关闭；关闭时不计入结果。Mastercard 官方说明其汇率为跨境交易的参考转换汇率，实际发卡行可能不完全采用该汇率或另收费用。</p>
      </section>
    </main>
  );
}





type Person = { id: string; name: string };
type Bill = {
  id: string;
  date: string;
  title: string;
  amount: number;
  payerId: string;
  shareIds: string[];
  note: string;
  currency?: string;
  usdAmount?: number;
};

const today = new Date().toISOString().slice(0, 10);

function TravelAA() {
  const [people, setPeople] = useState<Person[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [settlementResets, setSettlementResets] = useState<Array<{personId:string; resetAt:string; adjustments:Record<string,number>; cnyAdjustments:Record<string,number>}>>([]);
  const [tab, setTab] = useState<'add' | 'history' | 'settle'>('add');
  const [personName, setPersonName] = useState('');
  const [date, setDate] = useState(today);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(() => {
    try {
      return window.localStorage.getItem('travel-aa-last-currency') || 'USD';
    } catch {
      return 'USD';
    }
  });
  const [fxRate, setFxRate] = useState<number | null>(1);
  const [usdAmount, setUsdAmount] = useState<number | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [fxFetchedAt, setFxFetchedAt] = useState<string | null>(null);
  const [rateModal, setRateModal] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [resetModal, setResetModal] = useState(false);
  const [personResetTarget, setPersonResetTarget] = useState<Person | null>(null);
  const [payerId, setPayerId] = useState('');
  const [shareIds, setShareIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const initializedPeopleRef = useRef(false);
  const choicePointerStart = useRef<{ x: number; y: number } | null>(null);

  const startChoicePointer = (event: PointerEvent<HTMLButtonElement>) => {
    choicePointerStart.current = { x: event.clientX, y: event.clientY };
  };

  const activateChoice = (event: PointerEvent<HTMLButtonElement>, action: () => void) => {
    const start = choicePointerStart.current;
    choicePointerStart.current = null;
    if (!start) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved < 10) action();
  };

  const CURRENCIES = [['USD','美元'],['CNY','人民币'],['EUR','欧元'],['GBP','英镑'],['JPY','日元'],['CAD','加元'],['AUD','澳元'],['MXN','墨西哥比索'],['CHF','瑞士法郎'],['THB','泰铢'],['VND','越南盾'],['SGD','新加坡元'],['KRW','韩元'],['HKD','港币'],['TWD','新台币'],['MYR','马来西亚林吉特'],['INR','印度卢比'],['NZD','新西兰元'],['ARS','阿根廷比索'],['BRL','巴西雷亚尔'],['PEN','秘鲁索尔'],['BOB','玻利维亚诺'],['CLP','智利比索']] as const;

  const loadMastercardRate = async (nextCurrency: string) => {
    if (nextCurrency === 'USD') {
      setFxRate(1);
      const v = Number(amount);
      setUsdAmount(v > 0 ? v : null);
      return;
    }
    if (nextCurrency === 'CNY') {
      setFxRate(null);
      setFxFetchedAt(null);
      setUsdAmount(null);
      return;
    }
    setFxLoading(true);
    try {
      {
        const response = await api.get('/api/rates/mastercard?currency=' + encodeURIComponent(nextCurrency));
        const data = response.data as { rate: number };
        if (!(data.rate > 0)) throw new Error('invalid rate');
        setFxRate(data.rate);
        setFxFetchedAt(new Date().toLocaleString('zh-CN', { hour12: false }));
        const v = Number(amount);
        setUsdAmount(v > 0 ? v * data.rate : null);
      }
      setError('');
    } catch {
      setFxRate(null);
      setUsdAmount(null);
      setFxFetchedAt(null);
      setModalMessage('汇率获取失败，请稍后重试。');
      setRateModal(true);
    } finally {
      setFxLoading(false);
    }
  };
  const handleCurrencyChange = (nextCurrency: string) => {
    setCurrency(nextCurrency);
    setFxFetchedAt(null);
    setFxRate(nextCurrency === 'USD' ? 1 : null);
    setUsdAmount(null);
    setError('');
    try {
      window.localStorage.setItem('travel-aa-last-currency', nextCurrency);
    } catch {
      // Ignore storage failures; the current selection still works.
    }
    void loadMastercardRate(nextCurrency);
  };

  async function load() {
    try {
      const [p, b, sr] = await Promise.all([
        api.get('/api/people'),
        api.get('/api/bills'),
        api.get('/api/settlement-resets'),
      ]);
      const nextPeople = (p.data.people || []) as Person[];
      setPeople(nextPeople);
      setBills((b.data.bills || []) as Bill[]);
      setSettlementResets((sr.data.resets || []) as Array<{personId:string; resetAt:string; adjustments:Record<string,number>; cnyAdjustments:Record<string,number>}>);
      if (!initializedPeopleRef.current) {
        setPayerId(nextPeople[0]?.id || '');
        setShareIds(nextPeople.map(x => x.id));
        initializedPeopleRef.current = true;
      } else {
        setPayerId(prev => prev && nextPeople.some(p => p.id === prev) ? prev : (nextPeople[0]?.id || ''));
        setShareIds(prev => prev.filter(id => nextPeople.some(p => p.id === id)));
      }
      setError('');
    } catch {
      setModalMessage('云端数据读取失败，请稍后重试。');
      setRateModal(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setDate(today);
    setTitle('');
    setAmount('');
    const lastCurrency = (() => {
      try {
        return window.localStorage.getItem('travel-aa-last-currency') || currency;
      } catch {
        return currency;
      }
    })();
    setCurrency(lastCurrency);
    setFxRate(lastCurrency === 'USD' ? 1 : null);
    setFxFetchedAt(null);
    setUsdAmount(null);
    setPayerId(people[0]?.id || '');
    setShareIds(people.map(x => x.id));
    setNote('');
  };

  const addPerson = async () => {
    const name = personName.trim();
    if (!name) return;
    setSaving(true);
    try {
      await api.post('/api/people', { name });
      setPersonName('');
      await load();
    } catch {
      setModalMessage('添加人员失败，可能已经存在同名人员。');
      setRateModal(true);
    } finally {
      setSaving(false);
    }
  };

  const renamePerson = async (person: Person) => {
    const next = window.prompt('修改人员名称', person.name)?.trim();
    if (!next || next === person.name) return;
    setSaving(true);
    try {
      await api.put('/api/people/' + person.id, { name: next });
      await load();
    } catch {
      setModalMessage('修改人员失败。');
      setRateModal(true);
    } finally {
      setSaving(false);
    }
  };

  const deletePerson = async (person: Person) => {
    if (
      bills.some(b => b.payerId === person.id || b.shareIds.includes(person.id))
    ) {
      setModalMessage('这个人员已经出现在历史账单中，为保护历史数据不能删除。请使用“个人清算重置”处理。');
      setRateModal(true);
      return;
    }
    if (!window.confirm('确定删除 ' + person.name + ' 吗？')) return;
    setSaving(true);
    try {
      await api.delete('/api/people/' + person.id);
      await load();
    } catch {
      setModalMessage('删除人员失败。');
      setRateModal(true);
    } finally {
      setSaving(false);
    }
  };

  const saveBill = async () => {
    const numericAmount = Number(amount);
    if (!title.trim()) { setModalMessage('请填写账单名称。'); setRateModal(true); return; }
    if (!(numericAmount > 0)) { setModalMessage('请输入有效金额。'); setRateModal(true); return; }
    if (currency !== 'USD' && currency !== 'CNY' && !(fxRate && usdAmount)) {
      setModalMessage('请先获取汇率，再添加账单。');
      setRateModal(true);
      return;
    }
    if (!payerId) { setModalMessage('请选择付款人。'); setRateModal(true); return; }
    if (!shareIds.length) { setModalMessage('至少选择一位承担人。'); setRateModal(true); return; }
    setSaving(true);
    setError('');
    const payload = {
      date,
      title: title.trim(),
      amount: numericAmount,
      currency,
      usdAmount: currency === 'USD' ? numericAmount : usdAmount,
      payerId,
      shareIds,
      note: note.trim(),
    };
    try {
      if (editingId) await api.put('/api/bills/' + editingId, payload);
      else await api.post('/api/bills', payload);
      await load();
      resetForm();
      setTab('history');
    } catch {
      setModalMessage('账单保存失败，请检查网络后重试。');
      setRateModal(true);
    } finally {
      setSaving(false);
    }
  };

  const editBill = (bill: Bill) => {
    setEditingId(bill.id);
    setDate(bill.date);
    setTitle(bill.title);
    setAmount(String(bill.amount));
    setCurrency(bill.currency || 'USD');
    setFxRate(bill.currency === 'USD' ? 1 : bill.currency === 'CNY' ? null : 1);
    setUsdAmount(bill.usdAmount ?? bill.amount);
    setPayerId(bill.payerId);
    setShareIds(bill.shareIds);
    setNote(bill.note || '');
    setTab('add');
  };

  const resetPersonSettlement = async () => {
    const person = personResetTarget;
    if (!person) return;
    setSaving(true);
    try {
      await api.delete('/api/people/' + person.id + '/settlement-reset?rate=' + encodeURIComponent(String(settlementRateValue)));
      await load();
      setPersonResetTarget(null);
      resetForm();
      setError('');
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      setModalMessage(message || '个人清算重置失败，请稍后重试。');
      setRateModal(true);
    } finally {
      setSaving(false);
    }
  };

  const resetAllBills = async () => {
    setSaving(true);
    try {
      await api.delete('/api/bills');
      await load();
      setResetModal(false);
      resetForm();
      setError('');
    } catch {
      setModalMessage('结清重置失败，请稍后重试。');
      setRateModal(true);
    } finally {
      setSaving(false);
    }
  };

  const deleteBill = async (bill: Bill) => {
    if (
      !window.confirm(
        '确定删除“' + bill.title + '”吗？删除后 AA 结算会立即重新计算。'
      )
    )
      return;
    setSaving(true);
    try {
      await api.delete('/api/bills/' + bill.id);
      await load();
    } catch {
      setModalMessage('删除账单失败。');
      setRateModal(true);
    } finally {
      setSaving(false);
    }
  };

  const [settlementRate, setSettlementRate] = useState<number | null>(null);
  const [settlementRateUpdatedAt, setSettlementRateUpdatedAt] = useState('');
  const balances = useMemo(() => {
    const validIds = new Set(people.map(p => p.id));
    const usd: Record<string, number> = {};
    const cny: Record<string, number> = {};
    people.forEach(p => { usd[p.id] = 0; cny[p.id] = 0; });
    bills.forEach(b => {
      if (!validIds.has(b.payerId)) return;
      const ids = b.shareIds.filter(id => validIds.has(id));
      if (!ids.length) return;
      const isCny = b.currency === 'CNY';
      const amountValue = Number(isCny ? b.amount : (b.usdAmount ?? b.amount));
      const target = isCny ? cny : usd;
      const each = amountValue / ids.length;
      target[b.payerId] += amountValue;
      ids.forEach(id => { target[id] -= each; });
    });
    settlementResets.forEach(reset => {
      Object.entries(reset.adjustments || {}).forEach(([id, value]) => { if (validIds.has(id)) usd[id] += Number(value || 0); });
      Object.entries(reset.cnyAdjustments || {}).forEach(([id, value]) => { if (validIds.has(id)) cny[id] += Number(value || 0); });
    });
    return { usd, cny };
  }, [people, bills, settlementResets]);

  const settlementRateValue = settlementRate || rate || 0;
  const settlementBalances = useMemo(() => {
    const out: Record<string, number> = {};
    people.forEach(p => { out[p.id] = (balances.usd[p.id] || 0) * settlementRateValue + (balances.cny[p.id] || 0); });
    return out;
  }, [people, balances, settlementRateValue]);

  const transfers = useMemo(() => {
    const debtors = Object.entries(settlementBalances).filter(x => x[1] < -0.005).map(x => ({ id: x[0], value: -x[1] })).sort((a, b) => b.value - a.value);
    const creditors = Object.entries(settlementBalances).filter(x => x[1] > 0.005).map(x => ({ id: x[0], value: x[1] })).sort((a, b) => b.value - a.value);
    const result: Array<{ from: string; to: string; amount: number }> = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const value = Math.min(debtors[i].value, creditors[j].value);
      if (value > 0.005) result.push({ from: debtors[i].id, to: creditors[j].id, amount: value });
      debtors[i].value -= value; creditors[j].value -= value;
      if (debtors[i].value < 0.005) i++;
      if (creditors[j].value < 0.005) j++;
    }
    return result;
  }, [settlementBalances]);

  const refreshSettlementRate = async () => {
    try {
      const response = await api.get('/api/rates/usd-cny?force=1');
      const data = response.data as RateResponse;
      if (!(data.rate > 0)) throw new Error('invalid rate');
      setSettlementRate(data.rate); setSettlementRateUpdatedAt(data.updatedAt);
      setRate(data.rate); setSource(data.source); setUpdatedAt(data.updatedAt);
      try { localStorage.setItem('usd_cny_last_rate', String(data.rate)); } catch {}
    } catch {
      const cached = Number(localStorage.getItem('usd_cny_last_rate'));
      if (cached > 0) setSettlementRate(cached);
    }
  };

  useEffect(() => { if (tab === 'settle') void refreshSettlementRate(); }, [tab]);

  const totalUsd = bills.reduce((sum, b) => sum + (b.currency === 'CNY' ? 0 : (b.usdAmount ?? b.amount)), 0);
  const totalCny = bills.reduce((sum, b) => sum + (b.currency === 'CNY' ? b.amount : 0), 0) + totalUsd * settlementRateValue;
  const personNameOf = (id: string) =>
    people.find(p => p.id === id)?.name || '未知人员';

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <span className="eyebrow">TRAVEL · SHARED</span>
          <h1>旅行 AA 云端记账</h1>
          <p>多人共同使用 · 云端保存 · 自动累计结算</p>
        </div>
        <span className="sync">{loading ? '同步中…' : '● 云端已同步'}</span>
      </header>
      <nav className="tabs">
        <button
          className={tab === 'add' ? 'active' : ''}
          onClick={() => setTab('add')}
        >
          记账
        </button>
        <button
          className={tab === 'history' ? 'active' : ''}
          onClick={() => setTab('history')}
        >
          账单明细
        </button>
        <button
          className={tab === 'settle' ? 'active' : ''}
          onClick={() => setTab('settle')}
        >
          AA 结算
        </button>
      </nav>
      {error && (
        <div className="error">
          {error}
          <button onClick={() => setError('')}>×</button>
        </div>
      )}
      {tab === 'add' && (
        <section className="card">
          <h2>{editingId ? '修改账单' : '记一笔'}</h2>
          <div className="grid2 billTopGrid">
            <label>
              日期
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            </label>
            <label className="titleWithButton">
              <span>账单名称</span>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder=""
              />
            </label>
          </div>
          <div className="currencyAmountGrid">
            <label className="amountField">
              金额（{currency}）
              <input type="number" step="0.01" min="0" value={amount} onChange={e => {
                const value = e.target.value;
                setAmount(value);
                const v = Number(value);
                setUsdAmount(currency === 'USD' ? (v > 0 ? v : null) : currency === 'CNY' ? null : (fxRate && v > 0 ? v * fxRate : null));
              }} placeholder="0.00" />
            </label>
            <label className="currencyField">
              货币
              <select value={currency} onChange={e => handleCurrencyChange(e.target.value)}>
                {CURRENCIES.map(([code, name]) => <option key={code} value={code}>{code} · {name}</option>)}
              </select>
            </label>
          </div>
          <div className="fxControls">
            {currency !== 'USD' && currency !== 'CNY' ? (
              <>
                <button className="fetchRateButton" type="button" onClick={() => void loadMastercardRate(currency)} disabled={fxLoading}>
                  {fxLoading ? '获取中…' : '获取汇率'}
                </button>
                <span className={'fxTime ' + (fxRate ? 'success' : 'failure')}>
                  {fxLoading ? '正在获取汇率…' : fxRate ? (currency === 'CNY' ? 'USD/CNY 已获取 · ' : 'Mastercard 汇率已获取 · ') + (fxFetchedAt || '') : '汇率获取失败，请重试'}
                </span>
              </>
            ) : (
              <span className="fxTime success">{currency === 'CNY' ? 'CNY 直接记账，不换算' : 'USD 无需获取汇率'}</span>
            )}
          </div>
          {currency !== 'USD' && usdAmount !== null && (
            <div className="fxInfo">录入时折算：<strong>${usdAmount.toFixed(2)} USD</strong>（之后固定，不再更新）</div>
          )}
          <div className="sectionTitle">谁付款</div>
          <div className="chips">
            {people.map(p => (
              <button
                key={p.id}
                className={'choice ' + (payerId === p.id ? 'selected' : '')}
                type="button"
                onPointerDown={startChoicePointer}
                onPointerUp={e => activateChoice(e, () => setPayerId(p.id))}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="addBillBelowPayer">
            <button className="addBillButton" onClick={saveBill} disabled={saving}>
              {saving ? '保存中…' : editingId ? '保存修改' : '＋ 添加账单'}
            </button>
          </div>
          <div className="sectionTitle">
            哪些人承担这笔账 <small>共 {shareIds.length} 人</small>
          </div>
          <div className="chips">
            {people.map(p => (
              <button
                key={p.id}
                className={
                  'choice ' + (shareIds.includes(p.id) ? 'selected' : '')
                }
                type="button"
                onPointerDown={startChoicePointer}
                onPointerUp={e => activateChoice(e, () =>
                  setShareIds(current =>
                    current.includes(p.id)
                      ? current.filter(id => id !== p.id)
                      : current.concat(p.id)
                  )
                )}
              >
                {shareIds.includes(p.id) ? '✓ ' : ''}
                {p.name}
              </button>
            ))}
          </div>
          {amount && shareIds.length > 0 && (
            <div className="split">
              每人承担{' '}
              <b>{currency === 'CNY'
                ? Number(amount / shareIds.length).toFixed(2) + ' CNY'
                : 'USD ' + ((usdAmount ?? Number(amount)) / shareIds.length).toFixed(2) + ' USD'}</b>
            </div>
          )}
          <div className="formDivider" />
          <div className="peopleBox">
            <div className="sectionTitle">人员管理</div>
            <div className="personManageList">
              {people.map(p => (
                <div className="personManageRow" key={p.id}>
                  <span className="personNameBox">{p.name}</span>
                  <button className="personManageButton" onClick={() => renamePerson(p)}>改名</button>
                  <button className="personManageButton personDeleteButton" onClick={() => deletePerson(p)}>删除</button>
                </div>
              ))}
            </div>
            <div className="addPerson"><input value={personName} onChange={e => setPersonName(e.target.value)} placeholder="输入新同伴名字" /><button onClick={addPerson} disabled={saving}>＋ 添加</button></div>
          </div>
          <div className="actions">
            {editingId && <button onClick={resetForm}>取消修改</button>}
          </div>
        </section>
      )}
      {tab === 'history' && (
        <section className="card">
          <div className="titleRow">
            <h2>账单明细</h2>
            <span>{bills.length} 笔</span>
          </div>
          {bills.length === 0 ? (
            <div className="empty">还没有账单记录。</div>
          ) : (
            <div className="billList">
              {bills.map(b => (
                <article className="bill" key={b.id}>
                  <div className="billHead">
                    <div>
                      <b>{b.title}</b>
                      <small>
                        {b.date} · {personNameOf(b.payerId)} 付款
                      </small>
                    </div>
                    <strong>{b.currency && b.currency !== 'USD' ? b.amount.toFixed(2) + ' ' + b.currency + ' (' + (b.usdAmount ?? b.amount).toFixed(2) + ' USD)' : 'USD ' + (b.usdAmount ?? b.amount).toFixed(2)}</strong>
                  </div>
                  <div className="billMeta">
                    分摊：{b.shareIds.map(personNameOf).join('、')} · 每人{' '}
                    {b.currency === 'CNY'
                      ? (b.amount / b.shareIds.length).toFixed(2) + ' CNY'
                      : 'USD ' + ((b.usdAmount ?? b.amount) / b.shareIds.length).toFixed(2)}
                    {b.note ? (
                      <>
                        <br />
                        备注：{b.note}
                      </>
                    ) : null}
                  </div>
                  <div className="billActions">
                    <button onClick={() => editBill(b)}>修改</button>
                    <button className="danger" onClick={() => deleteBill(b)}>
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {tab === 'settle' && (
        <section className="card">
          <h2>AA 最终结算</h2>
          <p className="hint">
            非人民币账单在录入时只换算一次 USD；人民币账单直接保存人民币，不做换汇。最终分账统一显示人民币：非人民币部分按当前 USD/CNY 换算，人民币部分保持原金额不变。每次进入 AA 结算页面时刷新一次 USD/CNY。
          </p>
          <div className="summary">
            <div>
              <span>累计账单（CNY）</span>
              <b>{'CNY ' + totalCny.toFixed(2)}</b>
            </div>
            <div>
              <span>账单数量</span>
              <b>{bills.length}</b>
            </div>
          </div>
          {bills.length === 0 ? (
            <div className="empty">还没有账单。</div>
          ) : (
            <>
              <h3>每个人最终净额</h3>
              <div className="settlementRateInfo">
                当前 USD/CNY：<strong>{settlementRateValue ? settlementRateValue.toFixed(4) : '—'}</strong>
                {settlementRateUpdatedAt ? ' · ' + new Date(settlementRateUpdatedAt).toLocaleString('zh-CN', { hour12: false }) : ''}
              </div>
              <div className="balances">
                {people.map(p => {
                  const valueCny = settlementBalances[p.id] || 0;
                  return (
                    <div className="balance" key={p.id}>
                      <span>{p.name}</span>
                      <strong className={valueCny > 0.005 ? 'get' : valueCny < -0.005 ? 'pay' : ''}>
                        {valueCny > 0.005 ? '+' : ''}{'CNY ' + valueCny.toFixed(2)}{' '}
                        {valueCny > 0.005 ? '应收' : valueCny < -0.005 ? '应付' : '已平'}
                      </strong>
                    </div>
                  );
                })}
              </div>
              <h3>实际需要转账</h3>
              {transfers.length ? (
                <div className="transfers">
                  {transfers.map((t, i) => (
                    <div className="transfer" key={i}>
                      <span>{personNameOf(t.from)} → {personNameOf(t.to)}</span>
                      <b>{'CNY ' + t.amount.toFixed(2)}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">目前已经全部平账。</div>
              )}
              <div className="personalResetArea">
                <div className="personalResetTitle">个人清算重置</div>
                <div className="personalResetList">
                  {people.map(p => (
                    <div className="personalResetRow" key={p.id}>
                      <span>{p.name}</span>
                      <button type="button" className="personalResetButton" onClick={() => setPersonResetTarget(p)} disabled={saving}>
                        个人清算重置
                      </button>
                    </div>
                  ))}
                </div>
                <div className="personalResetHint">点击后表示这个人当前显示的应付/应收已经实际完成转账；历史账单、分摊记录、人员姓名全部保留，结算金额按已完成转账冲销。</div>
              </div>
              <div className="resetArea">
                <button className="resetButton" type="button" onClick={() => setResetModal(true)}>结清重置</button>
                <div className="resetHint">清除全部账单记录，人员不会被删除。</div>
              </div>
            </>
          )}
          {bills.length === 0 && (
            <div className="resetArea">
              <button className="resetButton" type="button" onClick={() => setResetModal(true)}>结清重置</button>
              <div className="resetHint">清除全部账单记录，人员不会被删除。</div>
            </div>
          )}
        </section>
      )}
      <footer>
        数据保存在云端，所有共同使用此链接的人看到同一份账单。页面每 5
        秒自动同步。
      </footer>
      {rateModal && (
        <div className="modalBackdrop" role="dialog" aria-modal="true">
          <div className="modalCard">
            <h3>{modalMessage === '请先获取汇率，再添加账单。' ? '汇率尚未获取' : '提示'}</h3>
            <p>{modalMessage || '请先获取汇率，再添加账单。'}</p>
            <button className="modalPrimary" onClick={() => setRateModal(false)}>知道了</button>
          </div>
        </div>
      )}
      {personResetTarget && (
        <div className="modalBackdrop" role="dialog" aria-modal="true">
          <div className="modalCard">
            <h3>个人清算重置</h3>
            <p>确定要重置“{personResetTarget.name}”的个人结算吗？这表示该人员已经完成当前应付/应收款。不会删除或修改任何历史账单，也不会删除或修改人员姓名，只把已经完成的转账从当前 AA 待结算金额中冲销。</p>
            <div className="modalActions">
              <button className="modalDanger" onClick={() => void resetPersonSettlement()} disabled={saving}>确认已转账，结算归零</button>
              <button className="modalSecondary" onClick={() => setPersonResetTarget(null)} disabled={saving}>取消</button>
            </div>
          </div>
        </div>
      )}
      {resetModal && (
        <div className="modalBackdrop" role="dialog" aria-modal="true">
          <div className="modalCard">
            <h3>结清重置</h3>
            <p>确定要清除重置吗？</p>
            <div className="modalActions">
              <button className="modalDanger" onClick={() => void resetAllBills()} disabled={saving}>重置</button>
              <button className="modalSecondary" onClick={() => setResetModal(false)} disabled={saving}>取消</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}



function App() {
  const [page, setPage] = useState<'rate' | 'aa'>('rate');
  return (
    <main className="appShell">
      <nav className="mainTabs">
        <button className={page === 'rate' ? 'active' : ''} onClick={() => setPage('rate')}>汇率计算器</button>
        <button className={page === 'aa' ? 'active' : ''} onClick={() => setPage('aa')}>记账</button>
      </nav>
      {page === 'rate' ? <ConverterPage /> : <TravelAA />}
    </main>
  );
}

export default App;
