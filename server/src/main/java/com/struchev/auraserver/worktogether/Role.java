package com.struchev.auraserver.worktogether;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Participant role on a Work Together session, per specification.md §2.
 * {@code HOST} is implicit write + session management, granted only via the
 * {@code hostToken} returned from session creation. {@code WRITE}/{@code READ}
 * come from a minted share link.
 */
public enum Role {
    HOST("host"),
    WRITE("write"),
    READ("read");

    private final String value;

    Role(String value) {
        this.value = value;
    }

    @JsonValue
    public String value() {
        return value;
    }

    @JsonCreator
    public static Role fromValue(String value) {
        for (Role role : values()) {
            if (role.value.equalsIgnoreCase(value)) {
                return role;
            }
        }
        throw new IllegalArgumentException("Unknown role: " + value);
    }
}
