FROM node:22-alpine

WORKDIR /opt/call-my-crm

COPY package.json ./
COPY src ./src
COPY public ./public

ENV PORT=8787
EXPOSE 8787

USER node

CMD ["node", "src/server.mjs"]
