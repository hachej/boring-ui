# The AWS recipe's container (AgentCore Runtime needs linux/arm64; ECS uses the same image).
# Build from the repository root: docker buildx build --platform linux/arm64 -f examples/aws/Dockerfile -t <ecr-uri>:<tag> .
FROM node:22.19.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ARCHITECTURE.json ./
COPY scripts ./scripts
COPY packages ./packages
COPY examples/shared ./examples/shared
COPY examples/aws ./examples/aws
# The repository keeps every dependency in devDependencies, so nothing is pruned.
RUN npm ci --ignore-scripts && npm run build
# uid/gid 1000 matches the host access point's POSIX user; umask 002 is set by the server.
USER 1000:1000
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "examples/aws/server.mjs"]
