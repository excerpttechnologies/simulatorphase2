'use client';

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import "../Effects.css";

type CauseEffect = {
    id: number;
    cause: string;
    effect: string;
};

type EffectsProps = {
    onComplete?: () => void;
};

const CAUSE_EFFECT_PAIRS: CauseEffect[] = [
    {
        id: 1,
        cause: "Resist Dispense Pump Pressure (↑) (e.g., from 15psi to 25psi)",
        effect: "Thickness Uniformity (↑) (Non-uniform coverage / streaks)",
    },
    {
        id: 2,
        cause: "PAB/Soft Bake Temp (↑) (e.g., from 100°C to 120°C)",
        effect: "CD ↑ (Lines appear wider, due to over-hardening)",
    },
    {
        id: 3,
        cause: "Coater Final Spin Speed (↓) (e.g., from 3000 RPM to 2000 RPM)",
        effect: "Thickness Uniformity (↑) (Edge-Fast coverage) / Resist Thickness (↑)",
    },
    {
        id: 4,
        cause: "Develop Puddle Time (↑) (e.g., from 60s to 90s)",
        effect: "CD ↓ (Lines appear skinnier, over-exposed effect)",
    },
    {
        id: 5,
        cause: "HMDS Prime Time (↓) (e.g., from 30s to 10s)",
        effect: "Adhesion Loss (Photoresist \"peeling\" or \"lifting\" off the wafer)",
    },
    {
        id: 6,
        cause: "Coater Cup Exhaust Fan (↑) (e.g., from 0.50 m/s to 1.0 m/s)",
        effect: "Thickness Uniformity (↑) (Center-Fast coverage / Drying spots)",
    },
];

function EffectsLED({
    color,
    size = "md",
    pulse = false,
}: {
    color: "green" | "blue" | "red" | "orange";
    size?: "sm" | "md";
    pulse?: boolean;
}) {
    return (
        <span
            className={`effects-led effects-led-${color} ${
                size === "sm" ? "effects-led-sm" : "effects-led-md"
            } ${pulse ? "effects-led-pulse" : ""}`}
        />
    );
}

export default function Effects({ onComplete }: EffectsProps) {
    const router = useRouter();

    const [shuffledEffects, setShuffledEffects] = useState<CauseEffect[]>([]);
    const [selectedCause, setSelectedCause] = useState<number | null>(null);
    const [matched, setMatched] = useState<Set<number>>(new Set());
    const [wrongPair, setWrongPair] = useState<{
        cause: number;
        effect: number;
    } | null>(null);
    const [completed, setCompleted] = useState<boolean>(false);

    const shuffleEffects = useCallback(() => {
        const effects = [...CAUSE_EFFECT_PAIRS].sort(() => Math.random() - 0.5);

        setShuffledEffects(effects);
        setMatched(new Set());
        setSelectedCause(null);
        setWrongPair(null);
        setCompleted(false);
    }, []);

    useEffect(() => {
        shuffleEffects();
    }, [shuffleEffects]);

    useEffect(() => {
        if (matched.size === CAUSE_EFFECT_PAIRS.length && !completed) {
            setCompleted(true);
            onComplete?.();
        }
    }, [matched, completed, onComplete]);

    const handleCauseClick = (id: number) => {
        if (matched.has(id)) return;

        setSelectedCause(id);
        setWrongPair(null);
    };

    const handleEffectClick = (effectId: number) => {
        if (selectedCause === null || matched.has(selectedCause)) return;

        if (selectedCause === effectId) {
            setMatched((prev) => new Set([...prev, selectedCause]));
            setSelectedCause(null);
        } else {
            setWrongPair({ cause: selectedCause, effect: effectId });

            setTimeout(() => {
                setWrongPair(null);
                setSelectedCause(null);
            }, 500);
        }
    };

    return (
        <section className="effects-page">
<header className="effects-smart-header">
  <div className="effects-smart-row">

    {/* LEFT — logo */}
    <div className="effects-logo-box">
      <span className="effects-logo-icon">⬡</span>
      <span className="effects-logo-text">SMaRT</span>
    </div>

    {/* MOVE TITLE SLIGHTLY LEFT */}
    <h1 className="effects-main-title">
      SMaRT <span>Simulator</span>
    </h1>

    {/* CENTER — HOME */}
    <div className="effects-home-center">
      <button
        className="effects-home-link"
        onClick={() => router.push("/")}
      >
        HOME
      </button>
    </div>

    {/* RIGHT — actions */}
    <div className="effects-right-actions">

      <button
        className="effects-module-btn"
        onClick={() => router.push("/Failure")}
      >
        Failure Module
      </button>

      <button
        className="effects-module-btn"
        onClick={() => router.push("/Recipe")}
      >
        Recipe Module
      </button>

      <div className="effects-wafer-box">
        <strong>300 mm</strong>
        <span>WAFER SIZE</span>
      </div>

      <div className="effects-mode-box">
        <span className="effects-status-dot"></span>
        <span className="effects-light-mode">☀ LIGHT MODE</span>
      </div>

    </div>
  </div>
</header>   
            <div className="effects-container">
                <div className="effects-header">
                    <div className="effects-title-box">
                        <h2 className="effects-title">Cause & Effect Matcher</h2>
                        <p className="effects-subtitle">
                            Match process parameter changes to their physical results
                        </p>
                    </div>

                    <div className="effects-header-actions">
                        <div className="effects-score-box">
                            <span className="effects-score-label">Matched:</span>
                            <span
                                className={`effects-score-value ${
                                    matched.size === CAUSE_EFFECT_PAIRS.length
                                        ? "effects-score-complete"
                                        : ""
                                }`}
                            >
                                {matched.size} / {CAUSE_EFFECT_PAIRS.length}
                            </span>
                        </div>

                        <button
                            className="effects-reset-btn"
                            onClick={shuffleEffects}
                        >
                            Reset
                        </button>
                    </div>
                </div>

                {completed && (
                    <div className="effects-success-box">
                        <EffectsLED color="green" pulse />
                        <span>PARAMETERS MASTERED ✓</span>
                        <EffectsLED color="green" pulse />
                    </div>
                )}

                <div className="effects-grid">
                    <div className="effects-column">
                        <h3 className="effects-column-title effects-cause-title">
                            Cause (Parameter Change)
                        </h3>

                        <div className="effects-card-list">
                            {CAUSE_EFFECT_PAIRS.map((pair) => {
                                const isMatched = matched.has(pair.id);
                                const isSelected = selectedCause === pair.id;
                                const isWrong = wrongPair?.cause === pair.id;

                                return (
                                    <button
                                        key={pair.id}
                                        onClick={() => handleCauseClick(pair.id)}
                                        disabled={isMatched}
                                        className={`effects-card ${
                                            isMatched ? "effects-card-matched" : ""
                                        } ${
                                            isSelected ? "effects-card-selected" : ""
                                        } ${
                                            isWrong ? "effects-card-wrong" : ""
                                        }`}
                                    >
                                        <EffectsLED
                                            color={
                                                isMatched
                                                    ? "green"
                                                    : isSelected
                                                    ? "blue"
                                                    : isWrong
                                                    ? "red"
                                                    : "orange"
                                            }
                                            size="sm"
                                        />
                                        <span>{pair.cause}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="effects-column">
                        <h3 className="effects-column-title effects-result-title">
                            Effect (Physical Result)
                        </h3>

                        <div className="effects-card-list">
                            {shuffledEffects.map((pair) => {
                                const isMatched = matched.has(pair.id);
                                const isWrong = wrongPair?.effect === pair.id;

                                return (
                                    <button
                                        key={pair.id}
                                        onClick={() => handleEffectClick(pair.id)}
                                        disabled={isMatched || selectedCause === null}
                                        className={`effects-card ${
                                            isMatched ? "effects-card-matched" : ""
                                        } ${
                                            isWrong ? "effects-card-wrong" : ""
                                        } ${
                                            selectedCause === null && !isMatched
                                                ? "effects-card-disabled"
                                                : ""
                                        }`}
                                    >
                                        <EffectsLED
                                            color={
                                                isMatched
                                                    ? "green"
                                                    : isWrong
                                                    ? "red"
                                                    : "orange"
                                            }
                                            size="sm"
                                        />
                                        <span>{pair.effect}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}