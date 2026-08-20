"""
Alembic Migration: Add is_favorite and tags columns to notes table

Revision ID: 8a7b9c1d2e3f
Revises: 1a2b3c4d5e6f
Create Date: 2026-08-18 10:00:00.000000

Assignment Task 3: Alembic-style migration with upgrade() and downgrade() functions
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '8a7b9c1d2e3f'
down_revision: Union[str, None] = '1a2b3c4d5e6f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Upgrade step: Applies schema changes forward.
    Adds `is_favorite` (Boolean) and `tags` (Array of Strings) to the `notes` table.
    """
    # Add is_favorite boolean column with server default FALSE
    op.add_column(
        'notes',
        sa.Column('is_favorite', sa.Boolean(), nullable=False, server_default=sa.text('false'))
    )
    
    # Add tags PostgreSQL text array column
    op.add_column(
        'notes',
        sa.Column('tags', postgresql.ARRAY(sa.String()), nullable=False, server_default=sa.text("'{}'::text[]"))
    )
    
    # Create composite index for user_id + is_favorite
    op.create_index(
        'ix_notes_user_is_favorite',
        'notes',
        ['user_id', 'is_favorite'],
        unique=False
    )


def downgrade() -> None:
    """
    Downgrade step: Reverts schema changes cleanly.
    Drops the created index and removed columns.
    """
    # Drop index first
    op.drop_index('ix_notes_user_is_favorite', table_name='notes')
    
    # Drop added columns in reverse order
    op.drop_column('notes', 'tags')
    op.drop_column('notes', 'is_favorite')
