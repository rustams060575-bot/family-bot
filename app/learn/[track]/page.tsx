"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import { motion } from "framer-motion";
import AppGate from "@/components/AppGate";
import { useApp } from "@/components/AppProvider";
import ScreenHeader from "@/components/ScreenHeader";
import VoiceAssistant from "@/components/VoiceAssistant";
import { trackById } from "@/lib/client/tracks";
import { rise, spring } from "@/lib/motion";

function TrackScreen({ trackId }: { trackId: string }) {
  const { haptic } = useApp();
  const track = trackById(trackId);
  const [topicId, setTopicId] = useState(track?.topics?.[0]?.id);
  if (!track?.topics) notFound();
  const topic = track.topics.find((item) => item.id === topicId) ?? track.topics[0];

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader
        eyebrow={track.name}
        title={
          <>
            {topic.title.split(" ")[0]} <em className="italic text-champagne">{topic.title.split(" ").slice(1).join(" ")}</em>
          </>
        }
        caption={topic.caption}
      />

      {/* Темы — горизонтальная лента, выбранная отмечена общей подложкой */}
      <motion.div variants={rise} initial="hidden" animate="show" className="no-scrollbar -mx-6 mb-6 overflow-x-auto px-6">
        <div className="flex w-max gap-2">
          {track.topics.map((item) => {
            const active = item.id === topic.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setTopicId(item.id);
                  haptic("selection");
                }}
                className="relative min-h-11 rounded-full px-4"
              >
                {active && <motion.span layoutId={`topic-${track.id}`} transition={spring} className="absolute inset-0 rounded-full bg-paper" />}
                {!active && <span className="absolute inset-0 rounded-full ring-1 ring-inset ring-tint/10" />}
                <span className={`relative font-sans text-label font-medium uppercase tracking-[0.12em] ${active ? "text-ink" : "text-mist"}`}>
                  {item.title}
                </span>
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* key — новая тема начинает чистый диалог */}
      <VoiceAssistant key={`${track.id}-${topic.id}`} track={track} topic={topic} />
    </div>
  );
}

export default function TrackPage({ params }: { params: { track: string } }) {
  return (
    <AppGate>
      <TrackScreen trackId={params.track} />
    </AppGate>
  );
}
