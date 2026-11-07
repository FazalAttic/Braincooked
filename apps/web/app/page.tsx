'use client';

import React, { useState, useEffect } from 'react';
import {
  Activity,
  Flame,
  Clock,
  Zap,
  TrendingDown,
  TrendingUp,
  RefreshCw,
  Sliders,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Copy,
  Youtube,
  Instagram,
  Moon,
  BarChart3
} from 'lucide-react';
import { DashboardStats, FATIGUE_STAGES, getFatigueStage } from '../../../packages/shared';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isPairModalOpen, setIsPairModalOpen] = useState<boolean>(false);
  const [pairingToken, setPairingToken] = useState<string>('br_dev_token_secret_12345');
  const [copied, setCopied] = useState<boolean>(false);
  const [backendOnline, setBackendOnline] = useState<boolean>(false);

  // Fetch stats from Elysia backend
  const fetchStats = async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch(`${BACKEND_URL}/api/stats`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.stats) {
          setStats(data.stats);
          setBackendOnline(true);
          return;
        }
      }
      setBackendOnline(false);
    } catch {
      setBackendOnline(false);
      // Fallback preview data when backend is not yet started
      if (!stats) {
        setStats(getFallbackStats());
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 6000);
    return () => clearInterval(interval);
  }, []);

  const handleCopyToken = () => {
    navigator.clipboard.writeText(pairingToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentStats = stats || getFallbackStats();
  const stage = currentStats.fatigueStage || getFatigueStage(currentStats.today);

  // Platform share calculation
  const totalBoth = (currentStats.platforms.youtube.today + currentStats.platforms.instagram.today) || 1;
  const ytSharePercent = Math.round((currentStats.platforms.youtube.today / totalBoth) * 100);
  const igSharePercent = 100 - ytSharePercent;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* ------------------------------------------------------------------ */}
      {/* HEADER BAR */}
      {/* ------------------------------------------------------------------ */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-6 border-b border-cardBorder">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cardBg border border-cardBorder flex items-center justify-center shadow-lg shadow-black/40">
            <span
              className="w-3.5 h-3.5 rounded-full animate-pulse"
              style={{ backgroundColor: stage.color, boxShadow: `0 0 12px ${stage.color}` }}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black tracking-tight text-white">Brainroad</h1>
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-cream/10 text-cream border border-cream/20">
                Bun &middot; ElysiaJS &middot; Drizzle
              </span>
            </div>
            <p className="text-xs text-textMuted">Mindfulness & Attention Analytics Dashboard</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Backend Status indicator */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cardBg border border-cardBorder text-xs">
            <span className={`w-2 h-2 rounded-full ${backendOnline ? 'bg-stage-fresh animate-ping' : 'bg-stage-tired'}`} />
            <span className="text-textMuted">
              {backendOnline ? 'Elysia API Live' : 'Local Standalone Mode'}
            </span>
          </div>

          {/* Refresh Button */}
          <button
            onClick={fetchStats}
            disabled={isRefreshing}
            className="p-2 rounded-lg bg-cardBg border border-cardBorder text-textMuted hover:text-white hover:border-cream/30 transition-all"
            title="Refresh statistics"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-cream' : ''}`} />
          </button>

          {/* Extension Pairing Button */}
          <button
            onClick={() => setIsPairModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-cream text-obsidian text-xs font-bold hover:bg-white transition-all shadow-md shadow-cream/10"
          >
            <Sliders className="w-3.5 h-3.5" />
            Connect Extension
          </button>
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* HERO FATIGUE STAGE BANNER */}
      {/* ------------------------------------------------------------------ */}
      <section
        className="relative overflow-hidden rounded-2xl p-6 md:p-8 border transition-all"
        style={{
          backgroundColor: '#14120E',
          borderColor: `${stage.color}40`,
          boxShadow: `0 8px 32px ${stage.color}15`
        }}
      >
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2.5">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: stage.color, boxShadow: `0 0 10px ${stage.color}` }}
              />
              <span className="text-xs font-bold uppercase tracking-wider text-textMuted">
                Current Mental State
              </span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white flex items-center gap-3">
              <span>{stage.name}</span>
              <span
                className="text-xs font-bold px-2.5 py-1 rounded-md uppercase tracking-wider"
                style={{ backgroundColor: `${stage.color}20`, color: stage.color }}
              >
                {stage.stage}
              </span>
            </h2>
            <p className="text-sm text-textMuted leading-relaxed">
              {stage.description}
            </p>
          </div>

          <div className="flex flex-col items-end gap-1.5 min-w-[160px]">
            <div className="text-right">
              <span className="text-4xl md:text-5xl font-black text-white tabular-nums tracking-tight">
                {currentStats.today}
              </span>
              <span className="text-xs font-semibold text-textMuted ml-1.5 uppercase">today</span>
            </div>
            <span className="text-xs text-textMuted">
              Lifetime: <b className="text-white tabular-nums">{currentStats.total}</b>
            </span>
          </div>
        </div>

        {/* Subtle background ambient glow */}
        <div
          className="absolute -right-20 -bottom-20 w-80 h-80 rounded-full blur-3xl pointer-events-none opacity-20"
          style={{ backgroundColor: stage.color }}
        />
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* TOP 4 KPI CARDS */}
      {/* ------------------------------------------------------------------ */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Today Count */}
        <div className="bg-cardBg border border-cardBorder rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-textMuted tracking-wider">Shorts & Reels</span>
            <Activity className="w-4 h-4 text-cream" />
          </div>
          <div>
            <div className="text-3xl font-extrabold text-white tabular-nums">
              {currentStats.today}
            </div>
            <p className="text-xs text-textMuted mt-1">
              Target budget: <span className="text-white font-medium">50 max</span>
            </p>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-obsidian rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, (currentStats.today / 50) * 100)}%`,
                backgroundColor: stage.color
              }}
            />
          </div>
        </div>

        {/* Card 2: Active Watch Time */}
        <div className="bg-cardBg border border-cardBorder rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-textMuted tracking-wider">Active Watch Time</span>
            <Clock className="w-4 h-4 text-stage-warming" />
          </div>
          <div>
            <div className="text-3xl font-extrabold text-white tabular-nums">
              {currentStats.todayDwellMinutes} <span className="text-sm font-normal text-textMuted">mins</span>
            </div>
            <p className="text-xs text-textMuted mt-1">
              Continuous focus duration
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-textMuted">
            <Flame className="w-3.5 h-3.5 text-orange-400" />
            <span>~{Math.round(currentStats.todayDwellMinutes * 1.8)} estimated dopamine bursts</span>
          </div>
        </div>

        {/* Card 3: Average Attention Velocity */}
        <div className="bg-cardBg border border-cardBorder rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-textMuted tracking-wider">Attention Velocity</span>
            <Zap className="w-4 h-4 text-stage-tired" />
          </div>
          <div>
            <div className="text-3xl font-extrabold text-white tabular-nums">
              {currentStats.averageDwellSeconds} <span className="text-sm font-normal text-textMuted">sec/clip</span>
            </div>
            <p className="text-xs text-textMuted mt-1">
              {currentStats.averageDwellSeconds > 15 ? 'Mindful consumption' : 'Fast dopamine flicking'}
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs font-medium text-emerald-400">
            {currentStats.averageDwellSeconds > 15 ? (
              <>
                <TrendingUp className="w-3.5 h-3.5" /> High patience
              </>
            ) : (
              <>
                <TrendingDown className="w-3.5 h-3.5 text-amber-400" /> Skim velocity high
              </>
            )}
          </div>
        </div>

        {/* Card 4: Dopamine Saturation Index */}
        <div className="bg-cardBg border border-cardBorder rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-textMuted tracking-wider">Dopamine Saturation</span>
            <Moon className="w-4 h-4 text-stage-rot" />
          </div>
          <div>
            <div className="text-3xl font-extrabold text-white tabular-nums">
              {currentStats.dopamineIndex} <span className="text-sm font-normal text-textMuted">/100</span>
            </div>
            <p className="text-xs text-textMuted mt-1">
              {currentStats.dopamineIndex < 35 ? 'Calm baseline' : currentStats.dopamineIndex < 70 ? 'Elevated stimulation' : 'Brain rot danger'}
            </p>
          </div>
          <div className="w-full bg-obsidian rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${currentStats.dopamineIndex}%`,
                backgroundColor: currentStats.dopamineIndex > 70 ? '#9B51E0' : currentStats.dopamineIndex > 40 ? '#FFB367' : '#79D056'
              }}
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* PLATFORM COMPARISON & ATTENTION SPLIT */}
      {/* ------------------------------------------------------------------ */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Platform Breakdown */}
        <div className="lg:col-span-2 bg-cardBg border border-cardBorder rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white">Platform Attention Split</h3>
              <p className="text-xs text-textMuted">Comparing YouTube Shorts vs Instagram Reels today</p>
            </div>
            <span className="text-xs text-textMuted font-mono">
              YT {ytSharePercent}% &middot; IG {igSharePercent}%
            </span>
          </div>

          {/* Combined Visual Split Bar */}
          <div className="w-full h-3 rounded-full bg-obsidian overflow-hidden flex">
            <div
              className="h-full bg-platform-yt transition-all duration-500"
              style={{ width: `${ytSharePercent}%` }}
              title={`YouTube Shorts: ${ytSharePercent}%`}
            />
            <div
              className="h-full bg-platform-ig transition-all duration-500"
              style={{ width: `${igSharePercent}%` }}
              title={`Instagram Reels: ${igSharePercent}%`}
            />
          </div>

          {/* Cards for each platform */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* YouTube Shorts Card */}
            <div className="p-4 rounded-xl bg-obsidian/70 border border-cardBorder space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Youtube className="w-5 h-5 text-platform-yt" />
                  <span className="font-bold text-sm text-white">YouTube Shorts</span>
                </div>
                <span className="text-xs font-bold text-platform-yt">{ytSharePercent}%</span>
              </div>
              <div className="text-2xl font-black text-white tabular-nums">
                {currentStats.platforms.youtube.today} <span className="text-xs font-normal text-textMuted">watched</span>
              </div>
              <div className="flex justify-between text-xs text-textMuted pt-1 border-t border-cardBorder/40">
                <span>Watch time: <b className="text-white">{currentStats.platforms.youtube.dwellMinutes}m</b></span>
                <span>Lifetime: <b className="text-white">{currentStats.platforms.youtube.total}</b></span>
              </div>
            </div>

            {/* Instagram Reels Card */}
            <div className="p-4 rounded-xl bg-obsidian/70 border border-cardBorder space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Instagram className="w-5 h-5 text-platform-ig" />
                  <span className="font-bold text-sm text-white">Instagram Reels</span>
                </div>
                <span className="text-xs font-bold text-platform-ig">{igSharePercent}%</span>
              </div>
              <div className="text-2xl font-black text-white tabular-nums">
                {currentStats.platforms.instagram.today} <span className="text-xs font-normal text-textMuted">watched</span>
              </div>
              <div className="flex justify-between text-xs text-textMuted pt-1 border-t border-cardBorder/40">
                <span>Watch time: <b className="text-white">{currentStats.platforms.instagram.dwellMinutes}m</b></span>
                <span>Lifetime: <b className="text-white">{currentStats.platforms.instagram.total}</b></span>
              </div>
            </div>
          </div>
        </div>

        {/* Right 1 Col: Quick Action & Guidance */}
        <div className="bg-cardBg border border-cardBorder rounded-2xl p-6 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-cream" />
              Mindfulness Target
            </h3>
            <p className="text-xs text-textMuted leading-relaxed">
              Dopamine spikes from vertical video fatigue prefrontal cortex regulation. Every 20 minutes of continuous viewing, step away for 5 minutes of eye rest.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-obsidian/80 border border-cardBorder space-y-2">
            <div className="text-xs font-bold uppercase text-cream tracking-wider">Session Tip</div>
            <p className="text-xs text-textMuted">
              {currentStats.today > 50
                ? '⚠️ You have exceeded the 50-video threshold today. Consider closing short-form tabs for the evening.'
                : '✅ You are currently within a mindful window. Keep intentionality high.'}
            </p>
          </div>

          <button
            onClick={() => setIsPairModalOpen(true)}
            className="w-full py-2.5 rounded-lg border border-cardBorder text-xs font-bold text-cream hover:bg-cardBorder/30 transition-all flex items-center justify-center gap-2"
          >
            <Sliders className="w-3.5 h-3.5" />
            Manage Sync Settings
          </button>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 24-HOUR CIRCADIAN HEATMAP */}
      {/* ------------------------------------------------------------------ */}
      <section className="bg-cardBg border border-cardBorder rounded-2xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-cream" />
              24-Hour Circadian Consumption Heatmap
            </h3>
            <p className="text-xs text-textMuted">
              Visualizes which hours of the day you browse Shorts/Reels (revealing morning/late-night vulnerability windows)
            </p>
          </div>
          <span className="text-xs text-textMuted font-mono">
            Hours 00:00 &ndash; 23:00
          </span>
        </div>

        {/* 24 Columns Bar Grid */}
        <div className="grid grid-cols-12 sm:grid-cols-24 gap-1 pt-6 pb-2 items-end h-40">
          {currentStats.hourlyDistributionToday.map((count, hour) => {
            const max = Math.max(...currentStats.hourlyDistributionToday, 1);
            const heightPercent = Math.max(8, Math.round((count / max) * 100));
            const isLateNight = hour >= 23 || hour <= 4;

            return (
              <div key={hour} className="flex flex-col items-center gap-1.5 h-full justify-end group">
                <div
                  className="w-full rounded-sm transition-all duration-300 relative group-hover:opacity-100"
                  style={{
                    height: `${heightPercent}%`,
                    backgroundColor: count === 0
                      ? '#2E2B25'
                      : isLateNight
                        ? '#9B51E0'
                        : count > 10
                          ? '#FC4A52'
                          : '#FFE9B4',
                    opacity: count === 0 ? 0.3 : 0.85
                  }}
                >
                  {/* Tooltip */}
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-obsidian border border-cardBorder text-[10px] text-white px-1.5 py-0.5 rounded shadow pointer-events-none opacity-0 group-hover:opacity-100 whitespace-nowrap z-20">
                    {hour}:00 &middot; {count} clips
                  </div>
                </div>
                <span className="text-[9px] text-textMuted/60 font-mono">
                  {hour % 3 === 0 ? hour : ''}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 7-DAY HISTORY TREND & RECENT EVENTS FEED */}
      {/* ------------------------------------------------------------------ */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: 7-Day History Table */}
        <div className="bg-cardBg border border-cardBorder rounded-2xl p-6 space-y-4">
          <h3 className="text-lg font-bold text-white">7-Day Trend Timeline</h3>
          <div className="divide-y divide-cardBorder/60">
            {currentStats.history7Days.map((hist, idx) => (
              <div key={idx} className="py-2.5 flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-white">{hist.date}</span>
                  <div className="flex gap-2 text-textMuted mt-0.5">
                    <span>YT: {hist.youtube}</span>
                    <span>&middot;</span>
                    <span>IG: {hist.instagram}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-sm font-bold text-white tabular-nums">{hist.total}</span>
                  <span className="text-textMuted ml-1">videos</span>
                  <p className="text-[10px] text-textMuted">{hist.dwellMinutes} mins active</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Recent Stream Feed */}
        <div className="bg-cardBg border border-cardBorder rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">Recent Synced Videos</h3>
            <span className="text-xs text-textMuted">Live stream</span>
          </div>

          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
            {currentStats.recentEvents && currentStats.recentEvents.length > 0 ? (
              currentStats.recentEvents.map((ev, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-3 rounded-lg bg-obsidian/60 border border-cardBorder text-xs hover:border-cream/20 transition-all"
                >
                  <div className="flex items-center gap-2.5">
                    {ev.platform === 'youtube' ? (
                      <Youtube className="w-4 h-4 text-platform-yt flex-none" />
                    ) : (
                      <Instagram className="w-4 h-4 text-platform-ig flex-none" />
                    )}
                    <div>
                      <span className="font-mono text-white font-medium">{ev.videoId}</span>
                      <p className="text-[10px] text-textMuted">
                        Dwell: {(ev.dwellMs / 1000).toFixed(1)}s
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] text-textMuted font-mono">
                    {new Date(ev.watchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-textMuted py-8 text-center">
                No recent views recorded yet. Watch a Short or Reel to see it stream here!
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* EXTENSION PAIRING MODAL */}
      {/* ------------------------------------------------------------------ */}
      {isPairModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="bg-cardBg border border-cardBorder rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-cream" />
                <h3 className="text-lg font-bold text-white">Connect Chrome Extension</h3>
              </div>
              <button
                onClick={() => setIsPairModalOpen(false)}
                className="text-textMuted hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-textMuted leading-relaxed">
              Brainroad uses an <b>Offline-First Batched Sync Queue</b>. The extension records views with zero UI latency and synchronizes batches to ElysiaJS.
            </p>

            <div className="space-y-3">
              <label className="text-xs font-bold text-textMuted uppercase tracking-wider block">
                Backend API Endpoint
              </label>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-obsidian border border-cardBorder text-xs font-mono text-cream">
                <span className="truncate">{BACKEND_URL}/api/sync</span>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-bold text-textMuted uppercase tracking-wider block">
                Extension Pairing Token
              </label>
              <div className="flex items-center justify-between p-3 rounded-lg bg-obsidian border border-cardBorder text-xs font-mono text-white">
                <span className="truncate">{pairingToken}</span>
                <button
                  onClick={handleCopyToken}
                  className="ml-2 p-1.5 rounded hover:bg-cardBorder text-textMuted hover:text-white transition-all flex items-center gap-1"
                >
                  {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              onClick={() => setIsPairModalOpen(false)}
              className="w-full py-2.5 rounded-lg bg-cream text-obsidian font-bold text-xs hover:bg-white transition-all"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Fallback Sample Stats for initial load or offline demonstration
// ----------------------------------------------------------------------------
function getFallbackStats(): DashboardStats {
  return {
    today: 129,
    total: 1480,
    todayDwellMinutes: 38.4,
    averageDwellSeconds: 12.6,
    dopamineIndex: 68,
    fatigueStage: getFatigueStage(129),
    platforms: {
      youtube: { today: 125, total: 1140, dwellMinutes: 34.2 },
      instagram: { today: 4, total: 340, dwellMinutes: 4.2 }
    },
    history7Days: [
      { date: '2026-11-01', total: 64, youtube: 50, instagram: 14, dwellMinutes: 21.0 },
      { date: '2026-11-02', total: 88, youtube: 70, instagram: 18, dwellMinutes: 28.5 },
      { date: '2026-11-03', total: 42, youtube: 40, instagram: 2, dwellMinutes: 14.1 },
      { date: '2026-11-04', total: 110, youtube: 100, instagram: 10, dwellMinutes: 36.2 },
      { date: '2026-11-05', total: 95, youtube: 90, instagram: 5, dwellMinutes: 30.0 },
      { date: '2026-11-06', total: 140, youtube: 130, instagram: 10, dwellMinutes: 44.8 },
      { date: '2026-11-07', total: 129, youtube: 125, instagram: 4, dwellMinutes: 38.4 }
    ],
    hourlyDistributionToday: [
      2, 1, 0, 0, 0, 0, 0, 4, 8, 12, 15, 6, 14, 18, 9, 7, 5, 11, 8, 4, 3, 2, 0, 1
    ],
    recentEvents: [
      { platform: 'youtube', videoId: 'dQw4w9WgXcQ', dwellMs: 15400, watchedAt: Date.now() - 1000 * 60 * 2 },
      { platform: 'youtube', videoId: '9bZkp7q19f0', dwellMs: 8200, watchedAt: Date.now() - 1000 * 60 * 5 },
      { platform: 'instagram', videoId: 'CxY87b1Za', dwellMs: 22000, watchedAt: Date.now() - 1000 * 60 * 12 },
      { platform: 'youtube', videoId: 'kJQP7kiw5Fk', dwellMs: 6400, watchedAt: Date.now() - 1000 * 60 * 18 }
    ]
  };
}

