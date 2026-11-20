# local-dev
Local dev setup

## Setup

1. Copy the dotfiles to your home directory.
2. Make the cached completion file for mise:

   ```sh
   mkdir -p ~/.zfunc && mise completion zsh > ~/.zfunc/_mise
   ```

3. After a mise upgrade, do step 2 again.

Secrets are not in this repo. Keep them in a local file that is not synced.
