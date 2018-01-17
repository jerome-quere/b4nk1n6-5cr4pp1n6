FROM debian:9
MAINTAINER Jerome Quere<contact@jeromequere.com>
RUN apt-get update                                                                                              && \
    apt-get install -y                                                                                             \
        curl                                                                                                       \
        wget                                                                                                       \
        gnupg                                                                                                   && \
    echo "deb http://dl.google.com/linux/chrome/deb/ stable main" | tee /etc/apt/sources.list.d/google.list     && \
    wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add -                              && \
    curl -sL https://deb.nodesource.com/setup_9.x | bash -                                                      && \
    curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add -                                           && \
    echo "deb https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list               && \
    apt-get update                                                                                              && \
    apt-get install -y                                                                                             \
        google-chrome-stable                                                                                       \
        nodejs                                                                                                     \
        yarn

WORKDIR /app
ENTRYPOINT ["node", "index.js"]
COPY package.json yarn.lock /app/
RUN yarn install
COPY index.js /app/