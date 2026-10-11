"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import { motion } from "framer-motion";
import AppGate from "@/components/AppGate";
import { useApp } from "@/components/AppProvider";
import ScreenHeader from "@/components/ScreenHeader";
import VoiceAssistant from "@/components/VoiceAssistant";
import { KIDS_TOPIC, kidsTrackName, trackById } from "@/lib/client/tracks";
import { rise, spring } from "@/lib/motion";

function TrackScreen({ trackId }: { trackId: string }) {
  const { account, haptic } = useApp();
  const track = trackById(trackId);
  const [topicId, setTopicId] = useState(track?.topics?.[0]?.id);
  if (!track?.topics) notFound();
  const kid = !!account?.kid;
  const topic = kid ? KIDS_TOPIC : track.topics.find((item) => item.id === topicId) ?? track.topics[0];

  return (
    <div className={`flex flex-1 flex-col ${kid ? "font-rounded" : ""}`}>
      <ScreenHeader
        eyebrow={kid ? kidsTrackName(track) : track.name}
        title={topic.title}
        caption={topic.caption}
      />

      {/* Темы — горизонтальная лента капсул; выбранная отмечена общей подложкой. Детям не нужна. */}
      {!kid && (
        <motion.div variants={rise} initial="hidden" animate="show" className="no-scrollbar -mx-4 mb-6 overflow-x-auto px-4">
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
                  className="relative min-h-9 rounded-full px-4"
                >
                  <span className="absolute inset-0 rounded-full bg-fill" />
                  {active && <motion.span layoutId={`topic-${track.id}`} transition={spring} className="absolute inset-0 rounded-full bg-paper" />}
                  <span className={`relative text-subhead font-medium ${active ? "text-ink" : "text-paper"}`}>{item.title}</span>
                </button>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* key — новая тема начинает чистый диалог */}
      <VoiceAssistant key={`${track.id}-${topic.id}`} track={track} topic={topic} kid={kid} />
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
