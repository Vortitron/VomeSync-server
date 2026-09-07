"""Regression tests for website contact links.

These pages must not expose an email address and must not link to Reddit:
support goes through GitHub Issues, and an address published on a static
page is an address that gets scraped.

WHY THIS FILE MOVED
-------------------
It used to live in the VomeSync (HACS) repository, next to a ``website/``
directory that was moved here on 2026-08-15 by "Move the sync.vome.io
server out of the HACS repository".  The pages came; the tests did not, so
they went on asserting against a path that no longer existed and failed on
every run from that day on -- red for a reason nobody reading "website
contact links" would guess, in a pipeline that was already red.

The guard itself is worth keeping, so it now sits with the files it
guards.  If these pages move again, move this with them.
"""

from pathlib import Path


GITHUB_ISSUES_URL = "https://github.com/Vortitron/VomeSync/issues"
X_PROFILE_URL = "https://x.com/VomeHome"
SECURITY_AUDIT_PATH = "/security.html"
FORBIDDEN_SUBSTRINGS = (
	"mailto:",
	"support@vome.io",
	"reddit.com",
	"r/homeassistant",
)


def _repo_root() -> Path:
	"""Return the repo root directory (containing `website/`)."""
	return Path(__file__).resolve().parents[1]


def _read_text(path: Path) -> str:
	assert path.exists(), f"Expected file to exist: {path}"
	return path.read_text(encoding="utf-8")


def _assert_no_forbidden_substrings(content: str, *, path: Path) -> None:
	for forbidden in FORBIDDEN_SUBSTRINGS:
		assert forbidden not in content, f"Forbidden substring {forbidden!r} found in {path}"


def test_website_footer_support_uses_github() -> None:
	"""Website homepage footer should link to GitHub Issues and not expose email/Reddit."""
	path = _repo_root() / "website" / "index.html"
	content = _read_text(path)

	assert GITHUB_ISSUES_URL in content
	assert X_PROFILE_URL in content
	assert SECURITY_AUDIT_PATH in content
	_assert_no_forbidden_substrings(content, path=path)


def test_website_privacy_contact_uses_github() -> None:
	"""Privacy page contact section should link to GitHub Issues and not expose email/Reddit."""
	path = _repo_root() / "website" / "privacy" / "index.html"
	content = _read_text(path)

	assert GITHUB_ISSUES_URL in content
	_assert_no_forbidden_substrings(content, path=path)


def test_security_audit_page_exists() -> None:
	"""Security audit page should be present and avoid forbidden contact links."""
	path = _repo_root() / "website" / "security.html"
	content = _read_text(path)

	assert "<title>VomeSync Security Audit</title>" in content
	_assert_no_forbidden_substrings(content, path=path)
