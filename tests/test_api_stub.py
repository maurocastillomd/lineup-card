from datetime import date

import pytest

from lineup_card.adapters.api_stub import VendorAPI


def test_stub_explains_what_is_needed():
    api = VendorAPI(vendor="VALD")
    with pytest.raises(RuntimeError, match="club account"):
        api.fetch(date(2026, 9, 1), date(2026, 9, 2))
