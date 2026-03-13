'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

type Signal = 'buy' | 'sell' | 'neutral';
type Tone   = 'hawkish' | 'dovish' | 'neutral';

interface TickerScores {
  fundamental:  number;
  technical:    number;
  combined:     number;
  geopolitical: number;
  macro:        number;
  business:     number;
  sector:       number;
}

interface TickerIndicators {
  rsi:         number | null;
  ma20:        number | null;
  ma50:        number | null;
  macd:        number | null;
  signal_line: number | null;
}

interface TickerFundamentals {
  per:            number | null;
  pbr:            number | null;
  eps_growth:     number | null;
  revenue_growth: number | null;
  equity_ratio:   number | null;
  dividend_yield: number | null;
  is_etf:         boolean;
  expense_ratio:  number | null;
}

interface TickerItem {
  ticker:       string;
  name:         string;
  signal:       Signal;
  signal_jp:    string;
  verdict:      string;
  scores:       TickerScores;
  indicators:   TickerIndicators;
  fundamentals: TickerFundamentals;
  meta:         { country: string; sector: string; tech_reason: string };
}

interface ScoresResponse {
  tickers:         TickerItem[];
  news_adjustment: number;
  updated_at:      string;
  cache_ttl:       number;
}

interface SentimentResponse {
  tone:          Tone;
  tone_jp:       string;
  score:         number;
  adjustment:    number;
  hawkish_total: number;
  dovish_total:  number;
  updated_at:    string;
  error:         string | null;
}

// ─── 定数 ────────────────────────────────────────────────────────────────────

const API_BASE   = 'http://localhost:5001';
const REFRESH_MS = 300_000; // 5分

// ─── ユーティリティ ──────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, dec = 1, suffix = ''): string {
  if (v == null) return 'N/A';
  return `${v.toFixed(dec)}${suffix}`;
}

function fmtSign(v: number | null | undefined, dec = 1, suffix = ''): string {
  if (v == null) return 'N/A';
  return `${v >= 0 ? '+' : ''}${v.toFixed(dec)}${suffix}`;
}

// ─── スタイルマップ ──────────────────────────────────────────────────────────

const signalStyle: Record<Signal, {
  border: string; badge: string; bar: string; glow: string;
}> = {
  buy:     { border: 'border-emerald-500/40', badge: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40', bar: 'bg-emerald-400', glow: 'shadow-emerald-500/10' },
  sell:    { border: 'border-red-500/40',     badge: 'bg-red-500/20 text-red-400 border border-red-500/40',             bar: 'bg-red-400',     glow: 'shadow-red-500/10' },
  neutral: { border: 'border-slate-600/40',   badge: 'bg-slate-700/50 text-slate-400 border border-slate-600/40',       bar: 'bg-slate-400',   glow: '' },
};

const toneStyle: Record<Tone, { badge: string; dot: string }> = {
  dovish:  { badge: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40', dot: 'bg-emerald-400' },
  hawkish: { badge: 'bg-red-500/20 text-red-400 border border-red-500/40',             dot: 'bg-red-400' },
  neutral: { badge: 'bg-slate-700/50 text-slate-400 border border-slate-600/40',       dot: 'bg-slate-400' },
};

// ─── サブコンポーネント ──────────────────────────────────────────────────────

function ProgressBar({ value, colorClass }: { value: number; colorClass: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: '#334155' }}>
      <div
        className={`h-full rounded-full transition-all duration-700 ${colorClass}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function LayerBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-slate-500 w-10 shrink-0">{label}</span>
      <div className="flex-1 rounded-full h-1 overflow-hidden" style={{ background: '#334155' }}>
        <div className="h-full rounded-full bg-slate-400" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-slate-400 w-8 text-right tabular-nums">{value}/{max}</span>
    </div>
  );
}

function SummaryCard({ label, value, sub, accent }: {
  label: string; value: string | number; sub?: string; accent?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700/50 p-5" style={{ background: '#1e293b' }}>
      <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">{label}</p>
      <p className={`text-3xl font-bold tabular-nums ${accent ?? 'text-slate-200'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1.5">{sub}</p>}
    </div>
  );
}

function TickerCard({ item }: { item: TickerItem }) {
  const sig = item.signal as Signal;
  const st  = signalStyle[sig];
  const f   = item.fundamentals;
  const ind = item.indicators;
  const maAbove = ind.ma20 != null && ind.ma50 != null && ind.ma20 > ind.ma50;

  return (
    <div
      className={`rounded-xl border p-5 shadow-lg transition-all hover:brightness-110 ${st.border} ${st.glow}`}
      style={{ background: '#1e293b' }}
    >
      {/* ── ヘッダー ── */}
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-xl font-bold text-slate-100 tracking-wider">{item.ticker}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.badge}`}>
              {item.signal_jp}
            </span>
            {f.is_etf && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/40">
                ETF
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 truncate max-w-[200px]">{item.name}</p>
        </div>
        <div className="text-right shrink-0 ml-2">
          <p className="text-2xl font-bold text-slate-100 tabular-nums">
            {item.scores.combined}
            <span className="text-sm text-slate-500">点</span>
          </p>
          <p className="text-xs text-slate-500">{item.verdict.replace(/[✅⚠️❌]\s?/, '')}</p>
        </div>
      </div>

      {/* ── 総合スコアバー ── */}
      <div className="mb-1">
        <ProgressBar value={item.scores.combined} colorClass={st.bar} />
      </div>
      <div className="flex justify-between text-xs text-slate-600 mb-4">
        <span>0</span>
        <span>ファンダ {item.scores.fundamental} × 0.6 ＋ テク {item.scores.technical} × 0.4</span>
        <span>100</span>
      </div>

      {/* ── レイヤー内訳 ── */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-4">
        <LayerBar label="地政学" value={item.scores.geopolitical} max={20} />
        <LayerBar label="マクロ"  value={item.scores.macro}       max={25} />
        <LayerBar label="業績"   value={item.scores.business}    max={30} />
        <LayerBar label="セクター" value={item.scores.sector}     max={25} />
      </div>

      <div className="border-t my-3" style={{ borderColor: '#334155' }} />

      {/* ── テクニカル ── */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3">
        <div className="flex justify-between">
          <span className="text-slate-500">RSI</span>
          <span className={`font-medium tabular-nums ${
            ind.rsi == null ? 'text-slate-500' :
            ind.rsi > 70 ? 'text-red-400' :
            ind.rsi < 30 ? 'text-sky-400' : 'text-slate-300'
          }`}>
            {fmt(ind.rsi, 1)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">MA</span>
          <span className={`font-medium ${maAbove ? 'text-emerald-400' : 'text-red-400'}`}>
            {maAbove ? '↑ 上抜け' : '↓ 下抜け'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">MACD</span>
          <span className={`font-medium tabular-nums ${
            ind.macd != null && ind.signal_line != null
              ? ind.macd > ind.signal_line ? 'text-emerald-400' : 'text-red-400'
              : 'text-slate-500'
          }`}>
            {ind.macd != null && ind.signal_line != null
              ? ind.macd > ind.signal_line ? '↑ 強気' : '↓ 弱気'
              : 'N/A'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">テクニカル</span>
          <span className="text-slate-300 font-medium tabular-nums">{item.scores.technical}点</span>
        </div>
      </div>

      <div className="border-t my-3" style={{ borderColor: '#334155' }} />

      {/* ── ファンダメンタル ── */}
      {f.is_etf ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-500">経費率</span>
            <span className="text-slate-300 tabular-nums">
              {f.expense_ratio != null ? `${f.expense_ratio.toFixed(2)}%` : 'N/A'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">PER</span>
            <span className="text-slate-300 tabular-nums">{fmt(f.per, 1)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">配当</span>
            <span className="text-slate-300 tabular-nums">{fmt(f.dividend_yield, 2, '%')}</span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-500">PER</span>
            <span className="text-slate-300 tabular-nums">{fmt(f.per, 1)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">EPS成長</span>
            <span className={`font-medium tabular-nums ${
              f.eps_growth == null ? 'text-slate-500' :
              f.eps_growth >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}>
              {fmtSign(f.eps_growth, 1, '%')}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">売上成長</span>
            <span className={`font-medium tabular-nums ${
              f.revenue_growth == null ? 'text-slate-500' :
              f.revenue_growth >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}>
              {fmtSign(f.revenue_growth, 1, '%')}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">配当</span>
            <span className="text-slate-300 tabular-nums">{fmt(f.dividend_yield, 2, '%')}</span>
          </div>
        </div>
      )}

      {/* セクター */}
      {item.meta.sector && (
        <p className="text-xs text-slate-600 mt-3 truncate">
          {item.meta.sector}{item.meta.country ? ` · ${item.meta.country}` : ''}
        </p>
      )}
    </div>
  );
}

// ─── メインページ ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [scores,    setScores]    = useState<ScoresResponse | null>(null);
  const [sentiment, setSentiment] = useState<SentimentResponse | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<string>('');
  const [countdown, setCountdown] = useState(REFRESH_MS / 1000);

  const fetchData = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      if (force) await fetch(`${API_BASE}/api/scores/refresh`);
      const [sentRes, scoresRes] = await Promise.all([
        fetch(`${API_BASE}/api/sentiment`),
        fetch(`${API_BASE}/api/scores`),
      ]);
      if (!sentRes.ok || !scoresRes.ok) throw new Error('HTTP エラー');
      const [sentData, scoresData]: [SentimentResponse, ScoresResponse] =
        await Promise.all([sentRes.json(), scoresRes.json()]);
      setSentiment(sentData);
      setScores(scoresData);
      setLastFetch(new Date().toLocaleTimeString('ja-JP'));
      setCountdown(REFRESH_MS / 1000);
    } catch (e) {
      setError(
        `データ取得失敗: ${e instanceof Error ? e.message : '不明なエラー'}\n` +
        `→ cd investment_tool && python3 api_server.py を起動してください`
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // 初回 + 自動リフレッシュ
  useEffect(() => {
    fetchData();
    const id = setInterval(() => fetchData(), REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  // カウントダウン
  useEffect(() => {
    const id = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  // 集計
  const buyCount = scores?.tickers.filter(t => t.signal === 'buy').length ?? 0;
  const avgScore = scores?.tickers.length
    ? Math.round(scores.tickers.reduce((s, t) => s + t.scores.combined, 0) / scores.tickers.length)
    : 0;
  const tone = (sentiment?.tone ?? 'neutral') as Tone;
  const ts   = toneStyle[tone];

  return (
    <div className="min-h-screen p-6" style={{ background: '#0f172a' }}>
      <div className="max-w-6xl mx-auto">

        {/* ── ヘッダー ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-widest" style={{ color: '#e2e8f0' }}>
              📊 INVESTMENT DASHBOARD
            </h1>
            <p className="text-xs mt-1" style={{ color: '#475569' }}>
              Phase 2 · Fundamental × Technical Screener
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {sentiment && (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${ts.badge}`}>
                <span className={`w-2 h-2 rounded-full animate-pulse ${ts.dot}`} />
                {sentiment.tone_jp}
                <span className="opacity-60 text-xs">
                  ({sentiment.score >= 0 ? '+' : ''}{sentiment.score})
                </span>
                {sentiment.adjustment !== 0 && (
                  <span className="opacity-60 text-xs border-l border-current/30 pl-2">
                    {sentiment.adjustment > 0 ? '+' : ''}{sentiment.adjustment}補正
                  </span>
                )}
              </div>
            )}
            {lastFetch && (
              <span className="text-xs" style={{ color: '#475569' }}>更新: {lastFetch}</span>
            )}
          </div>
        </div>

        {/* ── エラー ─────────────────────────────────────────────────── */}
        {error && (
          <div className="rounded-xl border border-red-500/40 p-4 mb-6" style={{ background: 'rgba(239,68,68,0.08)' }}>
            <p className="text-red-400 text-sm whitespace-pre-line font-mono">{error}</p>
          </div>
        )}

        {/* ── ローディング ────────────────────────────────────────────── */}
        {loading && !scores && (
          <div className="flex items-center justify-center py-32">
            <div className="text-center">
              <div className="w-10 h-10 border-2 border-slate-700 border-t-emerald-400 rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm" style={{ color: '#475569' }}>
                API サーバーからデータ取得中...
              </p>
            </div>
          </div>
        )}

        {/* ── サマリーカード ──────────────────────────────────────────── */}
        {scores && (
          <>
            <div className="grid grid-cols-3 gap-4 mb-8">
              <SummaryCard
                label="スキャン銘柄数"
                value={scores.tickers.length}
                sub={`ニュース補正: ${scores.news_adjustment >= 0 ? '+' : ''}${scores.news_adjustment}点`}
              />
              <SummaryCard
                label="買いシグナル"
                value={buyCount}
                sub={`全体の ${scores.tickers.length ? Math.round(buyCount / scores.tickers.length * 100) : 0}%`}
                accent="text-emerald-400"
              />
              <SummaryCard
                label="平均スコア"
                value={`${avgScore}点`}
                sub={avgScore >= 70 ? '良好 ✓' : avgScore >= 55 ? '普通' : '要注意'}
                accent={avgScore >= 70 ? 'text-emerald-400' : avgScore >= 55 ? 'text-yellow-400' : 'text-red-400'}
              />
            </div>

            {/* ── 銘柄カード ─────────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {scores.tickers.map(item => (
                <TickerCard key={item.ticker} item={item} />
              ))}
            </div>
          </>
        )}

        {/* ── フッター ────────────────────────────────────────────────── */}
        <div className="border-t pt-4 flex items-center justify-between" style={{ borderColor: '#1e293b' }}>
          <p className="text-xs" style={{ color: '#334155' }}>
            🔄 5分ごと自動更新 · 次回まで{' '}
            <span className="font-medium" style={{ color: '#475569' }}>{countdown}秒</span>
          </p>
          <button
            onClick={() => fetchData(true)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-700 text-slate-400 text-xs hover:border-slate-500 hover:text-slate-200 transition-all disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          >
            <span className={loading ? 'animate-spin inline-block' : 'inline-block'}>↺</span>
            手動リフレッシュ
          </button>
        </div>

      </div>
    </div>
  );
}
