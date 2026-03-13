/**
 * useScrollEvents — subscribes to scroll and shiftTab events emitted by the
 * StdinFilter Transform stream. This replaces the old useMouse hook.
 *
 * Because filtering happens at the stream level (before Ink's listeners),
 * mouse sequences never reach the input box.
 */

import { useEffect, useRef } from "react";
import { getStdinFilter, type ScrollEvent } from "../stdinFilter.js";

interface UseScrollEventsOptions {
    onScroll?: (event: ScrollEvent) => void;
    onShiftTab?: () => void;
}

export function useScrollEvents({ onScroll, onShiftTab }: UseScrollEventsOptions) {
    const scrollRef = useRef(onScroll);
    const shiftTabRef = useRef(onShiftTab);
    scrollRef.current = onScroll;
    shiftTabRef.current = onShiftTab;

    useEffect(() => {
        const filter = getStdinFilter();
        if (!filter) return;

        const handleScroll = (evt: ScrollEvent) => scrollRef.current?.(evt);
        const handleShiftTab = () => shiftTabRef.current?.();

        filter.events.on("scroll", handleScroll);
        filter.events.on("shiftTab", handleShiftTab);

        return () => {
            filter.events.off("scroll", handleScroll);
            filter.events.off("shiftTab", handleShiftTab);
        };
    }, []); // filter is a stable singleton; no deps needed
}
