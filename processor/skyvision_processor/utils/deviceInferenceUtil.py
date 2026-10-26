"""The torch device a model runs on: an NVIDIA GPU, then Apple Silicon, then the CPU."""


def pick_device(torch, requested='auto'):
    if requested != 'auto':
        return requested
    if torch.cuda.is_available():
        return 'cuda'
    return 'mps' if torch.backends.mps.is_available() else 'cpu'


def empty_cache(torch):
    """Return cached GPU memory, so a model swapped out of memory does not keep its share."""
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
