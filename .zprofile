# The following lines were added by Docker Desktop to add commands to your PATH.
export PATH="$PATH:$HOME/.docker/bin"
# End of Docker Desktop section.

eval "$(/opt/homebrew/bin/brew shellenv)"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

# Created by `pipx` on 2025-08-11 21:35:14
export PATH="$PATH:$HOME/.local/bin"

# mise shims ahead of ~/.local/bin so mise-managed tool versions (e.g. uv) win over
# stale standalone installs (e.g. pipx's uv), with no per-shell activation cost.
export PATH="$HOME/.local/share/mise/shims:$PATH"
# export ADO_DIR=$HOME/src/core/cli
# export ADO_DIR=$HOME/src/secondary-core/core/cliexport LDFLAGS="$LDFLAGS -L$(brew --prefix
#  openssl)/lib"
# export CPPFLAGS="$CPPFLAGS -I$(brew --prefix
#   openssl)/include"
# export PKG_CONFIG_PATH="${PKG_CONFIG_PATH:+$
#  PKG_CONFIG_PATH:}$(brew --prefix
#  openssl)/lib/pkgconfig"
