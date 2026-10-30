package com.struchev.auraserver;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class AuraServerApplication {

    public static void main(String[] args) {
        SpringApplication.run(AuraServerApplication.class, args);
    }

}
