"""CLI command registration only; this outbound processor has no HTTP listener."""
from ..handler.processorInferenceHandler import manifest_handler, run_handler
from ..handler.modelInferenceHandler import publish_handler, train_handler, sync_handler, deployed_handler
from ..handler.workshopInferenceHandler import workshop_handler, workshop_manifest_handler
COMMANDS = {'workshop-run': workshop_handler, 'workshop-manifest': workshop_manifest_handler, 'manifest': manifest_handler, 'run': run_handler, 'publish-model': publish_handler,
            'train': train_handler, 'sync-models': sync_handler, 'run-deployed': deployed_handler}
