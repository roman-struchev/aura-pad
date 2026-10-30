package com.struchev.auraserver.worktogether;

import com.struchev.auraserver.worktogether.model.WtLink;
import com.struchev.auraserver.worktogether.model.WtSession;

/** Result of resolving a guest join URL's short {@code linkId} back to its session/link. */
public record GuestLinkContext(WtSession session, WtLink link) {
}
