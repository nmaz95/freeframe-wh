"""Web Push: the devices a user turned notifications on in.

The browser subscribes with the instance's VAPID public key and hands the
result here; the row is one device. A re-subscribe from the same browser
(after a sign-out, a key rotation the service forced, a row a dead push
removed) updates the row in place, keyed on the endpoint.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..middleware.auth import get_current_user
from ..middleware.rate_limit import rate_limit
from ..models.push import PushSubscription
from ..models.user import User
from ..schemas.push import PushStatusResponse, PushSubscribe, PushSubscriptionResponse

router = APIRouter(tags=["push"])


def _require_enabled() -> None:
    if not settings.push_enabled:
        raise HTTPException(status_code=503, detail="Push notifications are not configured on this instance")


@router.get("/me/push", response_model=PushStatusResponse)
def push_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not settings.push_enabled:
        return PushStatusResponse(enabled=False, public_key=None, subscriptions=[])
    rows = (
        db.query(PushSubscription)
        .filter(PushSubscription.user_id == current_user.id)
        .order_by(PushSubscription.created_at)
        .all()
    )
    return PushStatusResponse(
        enabled=True,
        public_key=settings.vapid_public_key,
        subscriptions=[PushSubscriptionResponse.model_validate(r, from_attributes=True) for r in rows],
    )


@router.post(
    "/me/push/subscriptions",
    response_model=PushSubscriptionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("push_subscribe", 30, 600))],
)
def subscribe(
    body: PushSubscribe,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_enabled()
    user_agent = (request.headers.get("user-agent") or "")[:500] or None
    row = db.query(PushSubscription).filter(PushSubscription.endpoint == body.endpoint).first()
    if row is None:
        row = PushSubscription(
            id=uuid.uuid4(),
            user_id=current_user.id,
            endpoint=body.endpoint,
            p256dh=body.keys.p256dh,
            auth=body.keys.auth,
            user_agent=user_agent,
        )
        db.add(row)
    else:
        # The same browser, subscribing again: whoever is signed in now owns
        # it, with the keys it holds now.
        row.user_id = current_user.id
        row.p256dh = body.keys.p256dh
        row.auth = body.keys.auth
        row.user_agent = user_agent
        row.last_failed_at = None
    db.commit()
    return PushSubscriptionResponse(
        id=row.id,
        endpoint=row.endpoint,
        user_agent=row.user_agent,
        created_at=row.created_at,
        last_used_at=row.last_used_at,
    )


@router.delete("/me/push/subscriptions/{subscription_id}", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(
    subscription_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = (
        db.query(PushSubscription)
        .filter(PushSubscription.id == subscription_id, PushSubscription.user_id == current_user.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Subscription not found")
    db.delete(row)
    db.commit()
    return None
