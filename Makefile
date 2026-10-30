.PHONY: test desktop-test server-test dev release

# Every component's checks: the desktop smoke suite + typecheck, the server's tests.
test: desktop-test server-test

desktop-test:
	cd desktop && npm run typecheck && npm run smoke

server-test:
	cd server && ./gradlew test

dev:
	cd desktop && npm run dev

release:
	bash scripts/release.sh
