/**
 * Coordinators fill work orders on phones: controls are at least 40px tall
 * below `md`, and the denser desktop size above it.
 */
export const TOUCH_INPUT = "h-10 md:h-8";

/** The Select trigger sizes itself through a data attribute, so match it. */
export const TOUCH_SELECT = "w-full data-[size=default]:h-10 md:data-[size=default]:h-8";
