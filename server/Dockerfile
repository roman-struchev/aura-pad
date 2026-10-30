FROM eclipse-temurin:25-jre
COPY ./build/libs/aura-server-*.jar application.jar
# The JVM defaults to a quarter of the container limit for its heap; sessions
# live in the heap, so give it most of it (the rest is metaspace, threads, buffers).
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=60", "-jar", "application.jar"]
